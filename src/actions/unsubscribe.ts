"use server";

import { query } from "@/lib/db";
import { unsubscribeTokenValid } from "@/lib/unsubscribe-links";

/**
 * Stop the free add-on reminder for one customer.
 *
 * Only that message. Visit reminders, booking confirmations, cancellation
 * notices and sign-in links carry on, because those are the service rather
 * than marketing, and somebody who does not know a cleaner is coming does not
 * get cleaned.
 *
 * Idempotent, so a second click after Outlook has already followed the link
 * says the same thing rather than erroring.
 */
export async function stopAddOnNudges(
  customerId: string,
  token: string,
): Promise<{ ok: boolean; message: string }> {
  if (!unsubscribeTokenValid(customerId, token)) {
    return { ok: false, message: "This link is not valid. Nothing has changed." };
  }

  try {
    const rows = await query<{ id: string }>(
      `update customers
          set nudge_opt_out_at = coalesce(nudge_opt_out_at, now()),
              updated_at = now()
        where id = $1
        returning id`,
      [customerId],
    );

    if (rows.length === 0) {
      return { ok: false, message: "We could not find that account." };
    }

    return {
      ok: true,
      message: "Done. You will not get the free add-on reminder again.",
    };
  } catch (err) {
    console.error("[unsubscribe] could not record the opt out", err);
    return { ok: false, message: "That did not save. Please try again." };
  }
}
