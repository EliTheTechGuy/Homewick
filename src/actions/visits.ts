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
