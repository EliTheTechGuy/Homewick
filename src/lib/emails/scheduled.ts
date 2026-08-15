import { createHash, randomBytes } from "node:crypto";
import { query } from "../db";
import { TIMEZONE, addDays, localHour, today, type ISODate } from "../dates";
import { sendEmail } from "../email";
import { site } from "../site";
import { sendOnce } from "./send-once";
import {
  feedbackRequestEmail,
  freeAddOnNudgeEmail,
  visitReminderEmail,
} from "./templates";

/**
 * The email the daily job sends.
 *
 * Both are keyed so they go out once and only once. A cron that runs twice, or
 * a deploy that triggers an extra run, must not produce a second reminder.
 * Keys are built from the thing being reminded about rather than from the
 * clock, so a retry on the same day is caught even if the run happens twice.
 */

export type ScheduledEmailResult = {
  remindersSent: number;
  nudgesSent: number;
  feedbackSent: number;
  skipped?: string;
};

/**
 * Email only goes out in the morning, local time.
 *
 * Vercel schedules in UTC and does not follow daylight saving, so a single
 * fixed time drifts an hour twice a year. The job therefore runs at both 14:00
 * and 15:00 UTC, and this window decides which of those two is actually 9am in
 * Texas. In summer the first run qualifies and the second finds nothing left
 * to send. In winter the first is 8am and skips, and the second sends.
 *
 * The upper bound is deliberately loose, because Vercel treats cron times as
 * approximate and may fire late.
 */
const SEND_FROM_HOUR = 9;
const SEND_UNTIL_HOUR = 11;

/** How far into a billing period to wait before nudging about the free add-on. */
const NUDGE_AFTER_DAYS = 2;

export async function sendScheduledEmails(
  from: ISODate = today(),
  hourNow: number = localHour(),
): Promise<ScheduledEmailResult> {
  if (hourNow < SEND_FROM_HOUR || hourNow > SEND_UNTIL_HOUR) {
    return {
      remindersSent: 0,
      nudgesSent: 0,
      feedbackSent: 0,
      skipped: `local hour ${hourNow} is outside the ${SEND_FROM_HOUR} to ${SEND_UNTIL_HOUR} window`,
    };
  }

  const remindersSent = await sendVisitReminders(from);
  const nudgesSent = await sendFreeAddOnNudges(from);
  const feedbackSent = await sendFeedbackRequests();
  return { remindersSent, nudgesSent, feedbackSent };
}

/**
 * Ask how a finished clean went, the morning after it is marked complete.
 *
 * Not hours after, because the customer needs to have walked in and seen it.
 * Asking while they are still at work gets an answer about nothing.
 *
 * Creating the feedback row is what claims the send. The unique constraint on
 * visit_id means a second run cannot ask twice about the same clean.
 */
async function sendFeedbackRequests(): Promise<number> {
  const visits = await query<{
    visit_id: string;
    first_name: string;
    email: string;
    on_date: string;
  }>(
    `select v.id as visit_id, c.first_name, c.email::text as email,
            (v.scheduled_for at time zone $1)::date::text as on_date
       from visits v
       join customers c on c.id = v.customer_id
       left join visit_feedback f on f.visit_id = v.id
      where v.status = 'completed'
        and v.completed_at is not null
        and v.completed_at > now() - interval '7 days'
        and f.id is null`,
    [TIMEZONE],
  );

  let sent = 0;
  for (const visit of visits) {
    try {
      const token = randomBytes(32).toString("base64url");

      const claimed = await query<{ id: string }>(
        `insert into visit_feedback (visit_id, channel, token_hash, sent_at)
         values ($1, 'email', $2, now())
         on conflict (visit_id) do nothing
         returning id`,
        [visit.visit_id, createHash("sha256").update(token).digest("hex")],
      );
      if (claimed.length === 0) continue;

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
      });

      if (delivered) {
        sent++;
      } else {
        // Release the claim so a later run can retry, matching how the other
        // scheduled email behaves. Only safe while nobody has answered.
        await query(
          `delete from visit_feedback where visit_id = $1 and rating is null`,
          [visit.visit_id],
        );
      }
    } catch (err) {
      console.error(`[email] feedback request failed for visit ${visit.visit_id}`, err);
    }
  }

  return sent;
}

/** Reminders for every cleaning happening tomorrow, member or not. */
async function sendVisitReminders(from: ISODate): Promise<number> {
  const tomorrow = addDays(from, 1);

  const visits = await query<{
    visit_id: string;
    customer_id: string;
    first_name: string;
    email: string;
    on_date: string;
    line1: string;
    line2: string | null;
    city: string;
    postal_code: string;
    free_add_on: string | null;
  }>(
    `select v.id as visit_id, c.id as customer_id, c.first_name,
            c.email::text as email,
            (v.scheduled_for at time zone $2)::date::text as on_date,
            p.line1, p.line2, p.city, p.postal_code,
            (select a.name from visit_add_ons va
               join add_ons a on a.id = va.add_on_id
              where va.visit_id = v.id and va.is_free_perk
              limit 1) as free_add_on
       from visits v
       join customers c on c.id = v.customer_id
       join properties p on p.id = v.property_id
      where (v.scheduled_for at time zone $2)::date = $1::date
        and v.status in ('scheduled', 'assigned')`,
    [tomorrow, TIMEZONE],
  );

  let sent = 0;
  for (const visit of visits) {
    // Keyed on the visit, so the reminder cannot be sent twice even if the
    // job runs again.
    const result = await sendOnce({
      eventKey: `visit:${visit.visit_id}`,
      kind: "visit_reminder",
      to: visit.email,
      customerId: visit.customer_id,
      message: visitReminderEmail({
        firstName: visit.first_name,
        onDate: visit.on_date,
        address: [visit.line1, visit.line2, `${visit.city}, TX ${visit.postal_code}`]
          .filter(Boolean)
          .join(", "),
        freeAddOnName: visit.free_add_on,
      }),
    }).catch((err) => {
      console.error(`[email] reminder failed for visit ${visit.visit_id}`, err);
      return { sent: false as const };
    });

    if (result.sent) sent++;
  }

  return sent;
}

/**
 * One nudge per billing period, for members who have not chosen their free
 * add-on and still have a cleaning left to attach it to.
 *
 * Nudging on the first day of a period would reach people who have only just
 * been charged, and nudging when no visit remains would send them to a page
 * that cannot help.
 */
async function sendFreeAddOnNudges(from: ISODate): Promise<number> {
  const periods = await query<{
    period_id: string;
    customer_id: string;
    first_name: string;
    email: string;
    next_visit: string;
  }>(
    `select sp.id as period_id, c.id as customer_id, c.first_name,
            c.email::text as email,
            (v.scheduled_for at time zone $3)::date::text as next_visit
       from subscription_periods sp
       join subscriptions s on s.id = sp.subscription_id
       join customers c on c.id = s.customer_id
       join lateral (
         select scheduled_for from visits
          where period_id = sp.id and status = 'scheduled'
            and scheduled_for >= now()
          order by scheduled_for
          limit 1
       ) v on true
      where s.status in ('active', 'pending_cancellation')
        and sp.free_addon_used = false
        and sp.period_start <= ($1::date - $2::int)
        and sp.period_end > $1::date`,
    [from, NUDGE_AFTER_DAYS, TIMEZONE],
  );

  let sent = 0;
  for (const period of periods) {
    const result = await sendOnce({
      eventKey: `period:${period.period_id}`,
      kind: "free_add_on_nudge",
      to: period.email,
      customerId: period.customer_id,
      message: freeAddOnNudgeEmail({
        firstName: period.first_name,
        nextVisitDate: period.next_visit,
      }),
    }).catch((err) => {
      console.error(`[email] nudge failed for period ${period.period_id}`, err);
      return { sent: false as const };
    });

    if (result.sent) sent++;
  }

  return sent;
}
