import { createHash, randomBytes } from "node:crypto";
import { query } from "../db";
import { TIMEZONE } from "../dates";
import { sendEmail } from "../email";
import { site } from "../site";
import { feedbackRequestEmail } from "./templates";

/**
 * Ask how a clean went.
 *
 * Sent a few hours after the visit rather than the next morning. The gap is
 * for the customer to get home and see the place; the shortness of it is
 * because a rating given while somebody still feels something is worth more
 * than one given tomorrow, and because the public review link sits on the
 * page they land on. Asking at the moment they feel good about it is the
 * whole point.
 *
 * The delay is Resend's, not ours. It accepts the message now and delivers it
 * later, which means no queue, no scheduler, and no dependency on a cron that
 * only runs twice a day.
 *
 * Creating the feedback row is what claims the send. The unique constraint on
 * visit_id is what stops the visit being asked about twice, whether that is a
 * double click on Mark complete or the daily sweep catching up.
 */
export async function requestFeedbackForVisit(
  visitId: string,
  options: { scheduledAt?: string } = {},
): Promise<{ sent: boolean; reason?: "already_asked" | "not_found" | "not_delivered" }> {
  const rows = await query<{ first_name: string; email: string; on_date: string }>(
    `select c.first_name, c.email::text as email,
            (v.scheduled_for at time zone $2)::date::text as on_date
       from visits v
       join customers c on c.id = v.customer_id
      where v.id = $1 and v.status = 'completed'`,
    [visitId, TIMEZONE],
  );
  const visit = rows[0];
  if (!visit) return { sent: false, reason: "not_found" };

  const token = randomBytes(32).toString("base64url");
  const claimed = await query<{ id: string }>(
    `insert into visit_feedback (visit_id, channel, token_hash, sent_at)
     values ($1, 'email', $2, now())
     on conflict (visit_id) do nothing
     returning id`,
    [visitId, createHash("sha256").update(token).digest("hex")],
  );
  if (claimed.length === 0) return { sent: false, reason: "already_asked" };

  const message = feedbackRequestEmail({
    firstName: visit.first_name,
    onDate: visit.on_date,
    feedbackUrl: `${site.url}/feedback/${token}`,
  });

  const { delivered } = await sendEmail({
    to: visit.email,
    subject: message.subject,
    text: message.text,
    html: message.html,
    scheduledAt: options.scheduledAt,
  });

  if (!delivered) {
    // Release the claim so the daily sweep can try again. Only ever safe
    // while nobody has answered, which is guaranteed here: the row was
    // created a moment ago and its token has not been sent anywhere.
    await query(`delete from visit_feedback where visit_id = $1 and rating is null`, [
      visitId,
    ]);
    return { sent: false, reason: "not_delivered" };
  }

  return { sent: true };
}

/**
 * How long after a clean to ask.
 *
 * Long enough that somebody who was out has come home to it. Short enough
 * that it is still the same day and still the same feeling.
 */
export const FEEDBACK_DELAY = "in 3 hours";
