"use server";

import { createHash } from "node:crypto";
import { z } from "zod";
import { queryOne, transaction } from "@/lib/db";
import { TIMEZONE, formatLong } from "@/lib/dates";
import { alertOwner } from "@/lib/alert";

/**
 * Submitting feedback from the emailed link.
 *
 * The rating decides whether we chase a problem. It never decides who is
 * invited to review us publicly, because steering only happy customers toward
 * a review breaches Google's policies and the FTC's 2024 rule on suppressing
 * negative reviews. Everyone sees the same link on the thank you page.
 */

const submission = z.object({
  token: z.string().trim().min(1),
  rating: z.coerce.number().int().min(1).max(5),
  comment: z.string().trim().max(2000).optional().or(z.literal("")),
});

/** Anything at or below this needs a person to follow up. */
const RECOVERY_THRESHOLD = 3;

export type FeedbackResult =
  | { ok: true; rating: number; recovery: boolean }
  | { ok: false; message: string };

export async function submitFeedback(raw: unknown): Promise<FeedbackResult> {
  const parsed = submission.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, message: "Choose a score from 1 to 5." };
  }

  const { token, rating, comment } = parsed.data;

  try {
    const result = await transaction(async (client) => {
      const { rows } = await client.query<{ id: string; responded_at: string | null }>(
        `select id, responded_at::text as responded_at
           from visit_feedback
          where token_hash = $1
          for update`,
        [createHash("sha256").update(token).digest("hex")],
      );

      const row = rows[0];
      if (!row) {
        return {
          ok: false as const,
          message: "That link is not valid. It may have been replaced by a newer one.",
        };
      }

      // Answering again is allowed. Somebody who scored in haste and then
      // wants to explain should not be told their opinion is locked.
      const needsRecovery = rating <= RECOVERY_THRESHOLD;

      await client.query(
        `update visit_feedback
            set rating = $2,
                response_text = nullif($3, ''),
                responded_at = now(),
                recovery_status = case
                  when $4 and recovery_status = 'none' then 'needed'::recovery_state
                  when not $4 and recovery_status = 'needed' then 'none'::recovery_state
                  else recovery_status
                end
          where id = $1`,
        [row.id, rating, comment ?? "", needsRecovery],
      );

      // Everything needed to pick up the phone, fetched inside the same
      // transaction so the alert below cannot describe a state that did not
      // commit.
      const who = needsRecovery
        ? (
            await client.query<{
              first_name: string;
              last_name: string;
              phone: string;
              email: string;
              on_date: string;
              line1: string;
              city: string;
            }>(
              `select c.first_name, c.last_name, c.phone, c.email::text as email,
                      (v.scheduled_for at time zone $2)::date::text as on_date,
                      p.line1, p.city
                 from visit_feedback f
                 join visits v on v.id = f.visit_id
                 join customers c on c.id = v.customer_id
                 join properties p on p.id = v.property_id
                where f.id = $1`,
              [row.id, TIMEZONE],
            )
          ).rows[0]
        : null;

      return { ok: true as const, rating, recovery: needsRecovery, who, comment };
    });
    // A bad score has to reach a person the same day, not sit in a tab
    // waiting to be noticed. The recovery flag was already being set and
    // nothing ever told anybody about it, which made the promise on the
    // confirmation page something the system could not keep.
    //
    // Outside the transaction and never allowed to fail the submission. The
    // rating is saved; a missing alert is a worse day, not lost feedback.
    if (result.ok && result.recovery && result.who) {
      const w = result.who;
      await alertOwner(
        `${w.first_name} rated a clean ${result.rating} out of 5`,
        `${w.first_name} ${w.last_name} scored the clean on ${formatLong(w.on_date)} ` +
          `at ${w.line1}, ${w.city} as ${result.rating} out of 5.\n\n` +
          `Call them today: ${w.phone}\n` +
          `Email: ${w.email}\n\n` +
          (result.comment
            ? `What they said:\n${result.comment}\n\n`
            : "They did not leave a comment.\n\n") +
          `The service agreement says we come back and re clean at no charge ` +
          `within 48 hours. Reaching them the same day is what makes that ` +
          `worth having.`,
      );
    }

    return result;
  } catch (err) {
    console.error("[feedback] submission failed", err);
    return { ok: false, message: "That did not save. Please try again." };
  }
}

/** Whether a link is live, used to render the page before anything is sent. */
export async function feedbackLinkStatus(
  token: string,
): Promise<{ valid: boolean; alreadyRated: number | null }> {
  if (!token) return { valid: false, alreadyRated: null };

  const row = await queryOne<{ rating: number | null }>(
    `select rating from visit_feedback where token_hash = $1`,
    [createHash("sha256").update(token).digest("hex")],
  );

  return { valid: Boolean(row), alreadyRated: row?.rating ?? null };
}
