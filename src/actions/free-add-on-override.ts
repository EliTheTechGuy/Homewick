"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { query } from "@/lib/db";
import { requireAdmin } from "@/lib/admin-auth";

/**
 * Decide, for one customer, whether their membership includes the free
 * monthly add-on.
 *
 * This exists because what a hand-entered customer was promised happened in a
 * phone call and is written down nowhere the system can read. Usually the
 * add-on was not part of it. Sometimes it was, or gets offered later to smooth
 * something over, and before this there was no way to record either.
 *
 * Three states rather than a checkbox. Null is "follow the tier", which is
 * what an ordinary membership should do so it keeps tracking the tier rather
 * than carrying a stale copy of it. True and false are decisions about this
 * customer. Clearing back to null is deliberately possible, because deciding
 * and then changing your mind should not leave a value behind that nobody
 * meant.
 */

const schema = z.object({
  subscriptionId: z.string().uuid(),
  /** Null clears the decision and goes back to whatever the tier says. */
  included: z.boolean().nullable(),
});

export async function setFreeAddOnOverride(
  raw: unknown,
): Promise<{ ok: boolean; message: string }> {
  const admin = await requireAdmin();
  if (!admin) return { ok: false, message: "Not signed in." };

  const parsed = schema.safeParse(raw);
  if (!parsed.success) return { ok: false, message: "That did not look right." };

  try {
    const rows = await query<{ id: string }>(
      `update subscriptions
          set free_add_on_override = $2, updated_at = now()
        where id = $1
          and status in ('active', 'paused', 'pending_cancellation', 'pending_payment')
        returning id`,
      [parsed.data.subscriptionId, parsed.data.included],
    );
    if (rows.length === 0) {
      return { ok: false, message: "That membership could not be found." };
    }

    revalidatePath("/admin/members");
    return {
      ok: true,
      message:
        parsed.data.included === null
          ? "Back to whatever their plan includes."
          : parsed.data.included
            ? "They get a free add-on every period."
            : "No free add-on for them.",
    };
  } catch (err) {
    console.error("[admin] free add-on override failed", err);
    return { ok: false, message: "That did not save. Please try again." };
  }
}
