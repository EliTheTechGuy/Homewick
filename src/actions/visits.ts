"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { query } from "@/lib/db";
import { requireAdmin } from "@/lib/admin-auth";

/**
 * Mark a cleaning done.
 *
 * Nothing set this before, which meant no visit was ever complete and the
 * feedback request had nothing to fire on. It is also what the day's list is
 * for: the owner works down it and ticks jobs off.
 *
 * The feedback email goes out the following morning rather than on this
 * click, so the customer has been home and seen the place.
 */
export async function markVisitComplete(
  visitId: unknown,
): Promise<{ ok: boolean; message: string }> {
  const admin = await requireAdmin();
  if (!admin) return { ok: false, message: "Not authorized." };

  const parsed = z.string().uuid().safeParse(visitId);
  if (!parsed.success) return { ok: false, message: "Unknown visit." };

  try {
    const rows = await query<{ id: string }>(
      `update visits
          set status = 'completed', completed_at = now()
        where id = $1 and status in ('scheduled', 'assigned')
        returning id`,
      [parsed.data],
    );

    if (rows.length === 0) {
      return { ok: false, message: "That visit is not open, so nothing changed." };
    }

    revalidatePath("/admin");
    return { ok: true, message: "Marked complete." };
  } catch (err) {
    console.error("[admin] marking visit complete failed", err);
    return { ok: false, message: "That did not save. Please try again." };
  }
}

/**
 * Record a visit we could not get into.
 *
 * The service agreement has always said that if entry cannot be obtained the
 * visit is treated as skipped and consumes its allotment for the period.
 * Nothing could set that status, so honouring the clause meant editing the
 * database by hand, and in practice the visit sat as scheduled for ever,
 * making a month where nobody got in look identical to one where both cleans
 * happened.
 *
 * It consumes the allotment because the trip was made and a cleaner was paid
 * for the hour. The reason is kept on the visit, since "nobody home" and
 * "code had changed and we were not told" lead to different conversations.
 */
export async function markVisitSkipped(
  visitId: unknown,
  reason: unknown,
): Promise<{ ok: boolean; message: string }> {
  const admin = await requireAdmin();
  if (!admin) return { ok: false, message: "Not authorized." };

  const parsed = z.string().uuid().safeParse(visitId);
  const note = z.string().trim().max(500).optional().safeParse(
    typeof reason === "string" && reason.trim() !== "" ? reason.trim() : undefined,
  );
  if (!parsed.success || !note.success) return { ok: false, message: "Unknown visit." };

  try {
    const rows = await query<{ id: string }>(
      `update visits
          set status = 'skipped',
              internal_notes = case
                when $2::text is null then internal_notes
                when internal_notes is null or internal_notes = '' then $3 || ': ' || $2
                else internal_notes || E'\n' || $3 || ': ' || $2
              end
        where id = $1 and status in ('scheduled', 'assigned')
        returning id`,
      [
        parsed.data,
        note.data ?? null,
        `${new Date().toISOString().slice(0, 10)} ${admin.actor}`,
      ],
    );

    if (rows.length === 0) {
      return { ok: false, message: "That visit is not open, so nothing changed." };
    }

    revalidatePath("/admin");
    return { ok: true, message: "Marked as no access." };
  } catch (err) {
    console.error("[admin] marking visit skipped failed", err);
    return { ok: false, message: "That did not save. Please try again." };
  }
}
