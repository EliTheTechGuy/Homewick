"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { query } from "@/lib/db";
import { requireAdmin } from "@/lib/admin-auth";

/**
 * Working a complaint.
 *
 * A low rating already flags itself for recovery, but until now nothing showed
 * those flags to anybody, so the flag was the end of the process rather than
 * the start of it. These are the two moves that follow: picking it up, and
 * closing it out with a note about what was done.
 *
 * Notes are kept because the second complaint from the same customer reads
 * very differently when you can see what happened after the first.
 */

const statuses = ["needed", "in_progress", "resolved"] as const;

type Result = { ok: boolean; message: string };

export async function setRecoveryStatus(
  feedbackId: unknown,
  status: unknown,
  notes: unknown,
): Promise<Result> {
  const admin = await requireAdmin();
  if (!admin) return { ok: false, message: "Not authorized." };

  const id = z.string().uuid().safeParse(feedbackId);
  const next = z.enum(statuses).safeParse(status);
  const text = z.string().trim().max(2000).optional().safeParse(
    typeof notes === "string" && notes.trim() !== "" ? notes.trim() : undefined,
  );

  if (!id.success || !next.success || !text.success) {
    return { ok: false, message: "That did not look right." };
  }

  try {
    // Notes append rather than replace, and each is stamped with who wrote it
    // and when, so a thread of what was tried survives.
    const stamp = `${new Date().toISOString().slice(0, 10)} ${admin.actor}`;
    const rows = await query<{ id: string }>(
      `update visit_feedback
          set recovery_status = $2::recovery_state,
              recovery_notes = case
                when $3::text is null then recovery_notes
                when recovery_notes is null or recovery_notes = ''
                  then $4 || ': ' || $3
                else recovery_notes || E'\\n' || $4 || ': ' || $3
              end
        where id = $1
        returning id`,
      [id.data, next.data, text.data ?? null, stamp],
    );

    if (rows.length === 0) return { ok: false, message: "That feedback is gone." };

    revalidatePath("/admin/feedback");
    return {
      ok: true,
      message:
        next.data === "resolved"
          ? "Closed out."
          : next.data === "in_progress"
            ? "Marked as being dealt with."
            : "Put back on the list.",
    };
  } catch (err) {
    console.error("[admin] updating recovery status failed", err);
    return { ok: false, message: "That did not save. Please try again." };
  }
}
