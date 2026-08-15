"use server";

import { createHash } from "node:crypto";
import { z } from "zod";
import { queryOne, transaction } from "@/lib/db";

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
    return await transaction(async (client) => {
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

      return { ok: true as const, rating, recovery: needsRecovery };
    });
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
