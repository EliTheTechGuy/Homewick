import { createHash, randomBytes } from "node:crypto";
import { query } from "../db";
import { TIMEZONE, addDays, localHour, today, type ISODate } from "../dates";
import { sendEmail } from "../email";
import { site } from "../site";
import { unsubscribeUrl } from "../unsubscribe-links";
import { sendOnce } from "./send-once";
import { requestFeedbackForVisit } from "./feedback-request";
import { sendVisitReminder } from "./visit-reminder";
import {
  feedbackRequestEmail,
  freeAddOnNudgeEmail,
  membershipEndedEmail,
} from "./templates";
import { MEMBERSHIP_FREQUENCIES, MEMBERSHIP_TIERS } from "../pricing";

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
  endedSent: number;
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

/**
 * How far back to look for work a run may have missed.
 *
 * A cron that fails, or a mail provider having a bad morning, must not lose a
 * message permanently. Yesterday's query asked about yesterday and moved on.
 */
export const CATCH_UP_DAYS = 7;

/**
 * The period sizes that come with a free add-on, read from the catalog.
 *
 * Written as a list rather than a hard-coded 2 so that the tier definition
 * stays the only place this is decided. A once-a-month member has no free
 * add-on, and nudging them every month to claim one would be promising
 * something the booking form correctly refuses to give.
 */
export const FREE_ADD_ON_VISIT_COUNTS = MEMBERSHIP_FREQUENCIES.filter(
  (f) => MEMBERSHIP_TIERS[f].freeAddOn,
).map((f) => MEMBERSHIP_TIERS[f].visitsPerPeriod);

export async function sendScheduledEmails(
  from: ISODate = today(),
  hourNow: number = localHour(),
): Promise<ScheduledEmailResult> {
  if (hourNow < SEND_FROM_HOUR || hourNow > SEND_UNTIL_HOUR) {
    return {
      remindersSent: 0,
      nudgesSent: 0,
      feedbackSent: 0,
      endedSent: 0,
      skipped: `local hour ${hourNow} is outside the ${SEND_FROM_HOUR} to ${SEND_UNTIL_HOUR} window`,
    };
  }

  const remindersSent = await sendVisitReminders(from);
  const nudgesSent = await sendFreeAddOnNudges(from);
  const feedbackSent = await sendFeedbackRequests();
  const endedSent = await sendMembershipEndedNotices(from);
  return { remindersSent, nudgesSent, feedbackSent, endedSent };
}

/**
 * The morning a membership is actually over.
 *
 * The cancellation email goes out the day somebody cancels, which can be six
 * weeks before the end date it quotes. By the time that date arrives it has
 * been forgotten, so the last cleaning happens and nothing marks the end. This
 * is the message that closes it off and asks whether they want to come back.
 *
 * Deliberately narrow about who counts:
 *
 *   ends_on has arrived, and it is the first day no longer covered, so on this
 *   morning the membership really is over rather than nearly over.
 *
 *   stripe_subscription_id is not null, which is only set once a payment
 *   succeeded. An abandoned signup is closed with status canceled and an
 *   ends_on of today, and telling somebody their membership has ended when
 *   they never had one is a strange message to receive.
 *
 *   the nudge opt-out is honoured, because this is a commercial message rather
 *   than a receipt.
 */
/**
 * Exported so the schema test can run this exact statement against a real
 * Postgres. Everything that keeps the wrong person from being told their
 * membership has ended is in these where clauses, and a test that retyped them
 * would only prove the copy works.
 */
export const ENDED_MEMBERSHIPS_SQL = `select s.id as subscription_id, c.id as customer_id, c.first_name,
            c.email::text as email, s.ends_on::text as ends_on,
            (select (v.scheduled_for at time zone $3)::date::text
               from visits v
              where v.subscription_id = s.id and v.status = 'completed'
              order by v.scheduled_for desc
              limit 1) as last_visit
       from subscriptions s
       join customers c on c.id = s.customer_id
      where s.ends_on is not null
        and s.ends_on <= $1::date
        and s.ends_on > ($1::date - $2::int)
        and s.status in ('canceled', 'pending_cancellation')
        and s.stripe_subscription_id is not null
        and c.nudge_opt_out_at is null`;

async function sendMembershipEndedNotices(from: ISODate): Promise<number> {
  const ended = await query<{
    subscription_id: string;
    customer_id: string;
    first_name: string;
    email: string;
    ends_on: string;
    last_visit: string | null;
  }>(ENDED_MEMBERSHIPS_SQL, [from, CATCH_UP_DAYS, TIMEZONE]);

  let sent = 0;
  for (const row of ended) {
    const result = await sendOnce({
      // Keyed on the subscription, not the day, so the catch-up window cannot
      // send a second copy to somebody who already got one.
      eventKey: `membership_ended:${row.subscription_id}`,
      kind: "membership_ended",
      to: row.email,
      customerId: row.customer_id,
      message: membershipEndedEmail({
        firstName: row.first_name,
        endedOn: row.ends_on,
        lastVisit: row.last_visit,
        unsubscribeUrl: unsubscribeUrl(site.url, row.customer_id),
      }),
    }).catch((err) => {
      console.error(
        `[email] end of membership notice failed for ${row.subscription_id}`,
        err,
      );
      return { sent: false as const };
    });

    if (result.sent) sent++;
  }

  return sent;
}

/**
 * The safety net, not the main path.
 *
 * A finished visit asks for feedback a few hours later, queued at the moment
 * it is marked complete. This sweep exists for the ones that did not go: the
 * mail provider was having a bad minute, or the visit was completed before
 * any of that existed.
 *
 * Seven days back, because after a week nobody remembers the clean well
 * enough for the answer to mean anything.
 */
async function sendFeedbackRequests(): Promise<number> {
  const visits = await query<{ visit_id: string }>(
    `select v.id as visit_id
       from visits v
       left join visit_feedback f on f.visit_id = v.id
      where v.status = 'completed'
        and v.completed_at is not null
        and v.completed_at > now() - interval '7 days'
        and f.id is null`,
  );

  let sent = 0;
  for (const visit of visits) {
    // No delay here. Whatever this is catching is already hours late, and
    // holding it further would only push it out of the window where somebody
    // still remembers the visit.
    const result = await requestFeedbackForVisit(visit.visit_id).catch((err: unknown) => {
      console.error(`[email] feedback request failed for visit ${visit.visit_id}`, err);
      return { sent: false as const };
    });
    if (result.sent) sent++;
  }

  return sent;
}

/**
 * Reminders for every cleaning happening tomorrow, member or not.
 *
 * The window covers today as well as tomorrow. Looking only at tomorrow meant
 * that a run which failed, or was skipped, or hit a mail provider having a bad
 * morning, lost those reminders permanently: the next day's run asked about
 * its own tomorrow and yesterday's visits were already behind it. The retry
 * machinery in sendOnce was there, but no query would ever have picked them up
 * again.
 *
 * A same-morning reminder is worth sending. The alternative is a cleaner
 * standing outside a flat whose occupant was never told.
 */
async function sendVisitReminders(from: ISODate): Promise<number> {
  const tomorrow = addDays(from, 1);

  const visits = await query<{ visit_id: string }>(
    `select v.id as visit_id
       from visits v
      where (v.scheduled_for at time zone $2)::date between $1::date and $3::date
        and v.status in ('scheduled', 'assigned')`,
    [from, TIMEZONE, tomorrow],
  );

  let sent = 0;
  for (const visit of visits) {
    const result = await sendVisitReminder(visit.visit_id, from).catch((err: unknown) => {
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
/** Exported for the schema test, for the same reason as the statement above. */
export const FREE_ADD_ON_NUDGE_SQL = `select sp.id as period_id, c.id as customer_id, c.first_name,
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
        and c.nudge_opt_out_at is null
        -- Only subscriptions that actually include a free add-on. Nothing
        -- marks a period as having no perk to claim, so free_addon_used stays
        -- false for ever on a tier without one, and this query would have
        -- offered a once-a-month member a free oven clean every month that the
        -- booking form and the checkout both correctly refuse to give them.
        --
        -- The same three answers as subscriptionIncludesFreeAddOn, in the same
        -- order: a decision made for this customer wins, then the tier, then
        -- no. Written twice because one runs in Postgres and the other in
        -- TypeScript, and a test drives both to make sure they agree.
        and coalesce(
              s.free_add_on_override,
              (s.interval_days is null and s.visits_per_period = any($4::int[]))
            )
        and sp.free_addon_used = false
        and sp.period_start <= ($1::date - $2::int)
        and sp.period_end > $1::date`;

async function sendFreeAddOnNudges(from: ISODate): Promise<number> {
  const periods = await query<{
    period_id: string;
    customer_id: string;
    first_name: string;
    email: string;
    next_visit: string;
  }>(
    FREE_ADD_ON_NUDGE_SQL,
    [from, NUDGE_AFTER_DAYS, TIMEZONE, FREE_ADD_ON_VISIT_COUNTS],
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
        // The only message here that carries one. Everything else is about
        // work somebody has paid for.
        unsubscribeUrl: unsubscribeUrl(site.url, period.customer_id),
      }),
    }).catch((err) => {
      console.error(`[email] nudge failed for period ${period.period_id}`, err);
      return { sent: false as const };
    });

    if (result.sent) sent++;
  }

  return sent;
}
