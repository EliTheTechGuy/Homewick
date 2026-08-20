import type { PoolClient } from "pg";
import {
  DEFAULT_VISIT_TIME,
  TIMEZONE,
  addDays,
  addMonths,
  daysBetween,
  firstWeekdayOnOrAfter,
  isBefore,
  isOnOrAfter,
  today,
  type ISODate,
} from "./dates";
import { timestamptzFromLocal, transaction } from "./db";

/**
 * Membership lifecycle: billing periods, visit generation, the free perk,
 * cancellation, and scheduled rate changes.
 *
 * Two rules shape everything here:
 *
 *   - `subscription_periods` is the entitlement ledger. Two cleanings and one
 *     free add-on belong to a *period*, not to a calendar month, so counting
 *     visits by date range at query time is not equivalent, it gets February
 *     wrong and breaks on mid-month signups.
 *
 *   - Nothing is a delete. Cancellation is a state with an end date, and
 *     visits keep generating until that date arrives.
 */

/** Generate this far forward, so a customer always sees upcoming visits. */
const GENERATION_HORIZON_DAYS = 45;

/** Never run further ahead than this, however wide the horizon math gets. */
const MAX_PERIODS_AHEAD = 3;

/** Gap between the two visits in a period when both share a weekday. */
const VISIT_SPACING_DAYS = 14;

/**
 * Minimum gap when the two cleanings sit on different weekdays. Ten days keeps
 * them spread across the month without forcing a full fortnight, which would
 * push the second past the period end for some weekday pairs.
 */
const MIN_SPACING_DAYS = 10;

/**
 * Nothing is ever scheduled inside this window. Someone who signs up at 2pm
 * must not be given a cleaner at 9am the same morning, and the crew needs
 * notice to be dispatched at all.
 */
export const MIN_LEAD_DAYS = 2;

export const CANCELLATION_NOTICE_DAYS = 14;
export const RATE_CHANGE_NOTICE_DAYS = 30;

export type SubscriptionRow = {
  id: string;
  customer_id: string;
  property_id: string;
  status:
    | "pending_payment"
    | "active"
    | "paused"
    | "pending_cancellation"
    | "canceled";
  monthly_amount_cents: number;
  visits_per_period: number;
  pet_surcharge_cents: number;
  preferred_weekday: number | null;
  preferred_weekday_second: number | null;
  started_on: ISODate;
  billing_day: number;
  /** Null is the ordinary monthly cycle. A value means every N days. */
  interval_days: number | null;
  pending_amount_cents: number | null;
  pending_amount_effective_on: ISODate | null;
  ends_on: ISODate | null;
};

export type Period = {
  start: ISODate;
  /** Exclusive: this is the next period's start date. */
  end: ISODate;
};

/**
 * The period boundaries are anchored to billing_day, which the schema
 * constrains to 1 to 28. Anchoring to the 29th to 31st inherits every February bug
 * there is, so the constraint is doing real work and this code relies on it.
 */
export function periodContaining(sub: SubscriptionRow, date: ISODate): Period {
  // A custom cadence is measured in whole days from the day service started,
  // and ignores billing_day entirely. Anchoring makes no sense when the cycle
  // is not a month: "the 12th of every 21 days" is not a thing.
  if (sub.interval_days != null) {
    if (sub.interval_days < 7) {
      throw new Error(`interval_days must be at least 7, got ${sub.interval_days}`);
    }
    let start = sub.started_on;
    let guard = 0;
    while (true) {
      const end = addDays(start, sub.interval_days);
      if (isBefore(date, end) || guard++ > 600) return { start, end };
      start = end;
    }
  }

  if (sub.billing_day < 1 || sub.billing_day > 28) {
    throw new Error(`billing_day must be between 1 and 28, got ${sub.billing_day}`);
  }

  // Walk forward from the signup date in whole months until we straddle `date`.
  let start = anchorOnOrBefore(sub.started_on, sub.billing_day);
  let guard = 0;
  while (true) {
    const end = addMonths(start, 1);
    if (isBefore(date, end) || guard++ > 600) return { start, end };
    start = end;
  }
}

/** The first billing anchor on or before the signup date. */
function anchorOnOrBefore(startedOn: ISODate, billingDay: number): ISODate {
  const [year, month] = startedOn.split("-").map(Number);
  const pad = (n: number) => String(n).padStart(2, "0");
  const thisMonth = `${year}-${pad(month)}-${pad(billingDay)}`;
  return isOnOrAfter(startedOn, thisMonth) ? thisMonth : addMonths(thisMonth, -1);
}

/**
 * Takes the subscription as well as the period, because the length of the next
 * one depends on the cadence and a Period alone cannot say what that is.
 */
export function nextPeriod(sub: SubscriptionRow, period: Period): Period {
  return {
    start: period.end,
    end:
      sub.interval_days != null
        ? addDays(period.end, sub.interval_days)
        : addMonths(period.end, 1),
  };
}

/**
 * The periods that should exist right now: the current one plus enough
 * lookahead to cover the horizon, stopping at a cancelled subscription's
 * end date.
 */
export function periodsToGenerate(
  sub: SubscriptionRow,
  from: ISODate = today(),
): Period[] {
  if (sub.status === "canceled") return [];

  const horizon = addDays(from, GENERATION_HORIZON_DAYS);
  const periods: Period[] = [];
  let period = periodContaining(sub, from);

  while (periods.length < MAX_PERIODS_AHEAD) {
    // A cancelled subscription stops generating once its end date is passed.
    if (sub.ends_on && isOnOrAfter(period.start, sub.ends_on)) break;
    periods.push(period);
    if (!isBefore(period.start, horizon)) break;
    period = nextPeriod(sub, period);
  }

  return periods;
}

/**
 * Where the two visits in a period land.
 *
 * Each cleaning has its own remembered weekday, so a member can take the first
 * on a Tuesday and the second on a Wednesday if that suits them. When both
 * fall on the same weekday the pattern is a clean fortnight. When they differ,
 * the second is the first occurrence of its weekday at least ten days after
 * the first, which keeps the two spread across the month rather than landing
 * next to each other.
 *
 * Nothing may cross into the next period. That is the no rollover rule from
 * the brief, and a visit pushed into next month is rollover wearing a hat.
 */
export function visitDatesForPeriod(
  period: Period,
  /** Weekday per cleaning. A null entry means no preference. */
  weekdays: (number | null)[],
  visitsPerPeriod: number,
  /**
   * Earliest date a visit may fall on. Used to keep the first period's
   * cleanings behind the onboarding deep clean, and to stop the daily
   * generator from ever scheduling something for today.
   */
  notBefore?: ISODate,
): ISODate[] {
  const earliest =
    notBefore && isBefore(period.start, notBefore) ? notBefore : period.start;

  const firstWeekday = weekdays[0] ?? null;
  const first =
    firstWeekday === null ? earliest : firstWeekdayOnOrAfter(earliest, firstWeekday);

  const dates: ISODate[] = [];

  for (let i = 0; i < visitsPerPeriod; i++) {
    let candidate: ISODate;

    if (i === 0) {
      candidate = first;
    } else {
      const wanted = weekdays[i] ?? firstWeekday;
      const notBeforeThis = addDays(first, i === 1 ? MIN_SPACING_DAYS : i * VISIT_SPACING_DAYS);

      candidate =
        wanted === null || wanted === firstWeekday
          ? addDays(first, i * VISIT_SPACING_DAYS)
          : firstWeekdayOnOrAfter(notBeforeThis, wanted);
    }

    // Pull back a week if that overshoots, then give up rather than place a
    // visit the member is not entitled to in this period.
    if (!isBefore(candidate, period.end)) {
      candidate = addDays(first, i * 7);
    }
    if (!isBefore(candidate, period.end)) continue;

    dates.push(candidate);
  }

  return dates;
}

/**
 * Create any missing periods and visits for one subscription.
 *
 * Idempotent by construction: the unique index on
 * (subscription_id, period_start) makes period creation a no-op on a second
 * run, and visits are only inserted up to the shortfall against the period's
 * allotment. Running this twice in one day must not double-book anybody.
 */
export async function generateForSubscription(
  client: PoolClient,
  sub: SubscriptionRow,
  from: ISODate = today(),
  /**
   * Earliest acceptable visit date. At signup this is the day after the
   * onboarding deep clean, so the deep clean stays first; on the daily cron
   * it just keeps visits out of the immediate future.
   */
  notBefore: ISODate = addDays(from, MIN_LEAD_DAYS),
): Promise<{ periodsCreated: number; visitsCreated: number }> {
  let periodsCreated = 0;
  let visitsCreated = 0;

  for (const period of periodsToGenerate(sub, from)) {
    const amountCents = rateForPeriod(sub, period);

    // A period that has not been invoiced yet must carry the rate that will
    // actually be charged. Written once and left alone, a period created
    // before a size change kept the old figure for ever, so the ledger and
    // Stripe quietly disagreed by the difference between two plans.
    //
    // An invoiced period is never touched: that money has already moved, and
    // rewriting the record of it would be worse than the disagreement.
    //
    // xmax distinguishes an insert from an update, so a corrected rate is not
    // counted as a period that was created.
    const inserted = await client.query<{ id: string; created: boolean }>(
      `insert into subscription_periods
         (subscription_id, period_start, period_end, visits_allotted, amount_cents)
       values ($1, $2, $3, $4, $5)
       on conflict (subscription_id, period_start) do update
         set amount_cents = excluded.amount_cents
         where subscription_periods.stripe_invoice_id is null
           and subscription_periods.amount_cents <> excluded.amount_cents
       returning id, (xmax = 0) as created`,
      [sub.id, period.start, period.end, sub.visits_per_period, amountCents],
    );

    let periodId = inserted.rows[0]?.id;
    if (periodId) {
      if (inserted.rows[0].created) periodsCreated++;
    } else {
      const existing = await client.query<{ id: string }>(
        `select id from subscription_periods
          where subscription_id = $1 and period_start = $2`,
        [sub.id, period.start],
      );
      periodId = existing.rows[0]?.id;
    }
    if (!periodId) continue;

    const counted = await client.query<{ count: string }>(
      `select count(*) as count from visits
        where period_id = $1 and status <> 'canceled'`,
      [periodId],
    );
    const existingVisits = Number(counted.rows[0]?.count ?? 0);

    const wanted = visitDatesForPeriod(
      period,
      [sub.preferred_weekday, sub.preferred_weekday_second],
      sub.visits_per_period,
      notBefore,
    );

    for (const date of wanted.slice(existingVisits)) {
      // Do not schedule a visit beyond a cancelled subscription's end date.
      if (sub.ends_on && isOnOrAfter(date, sub.ends_on)) continue;

      // No pet surcharge on generated visits. It is a one-time charge taken on
      // the booking that introduces the pet home, so repeating it here would
      // bill a member every fortnight for the life of their membership.
      // Whether the property has pets is still on the property row, which is
      // what the cleaner's assignment reads.
      // A visit is only real work once the membership behind it is paid for.
      // Generating it as pending keeps unpaid bookings off the schedule, out
      // of the reminder query and away from a cleaner's morning.
      await client.query(
        `insert into visits
           (customer_id, property_id, subscription_id, period_id, origin,
            service_type, status, scheduled_for, pet_surcharge_cents, slot)
         values ($4, $5, $6, $7, 'membership', 'standard', $8::visit_state,
                 ${timestamptzFromLocal(1, 2, 3)}, 0, $9)`,
        [
          date,
          DEFAULT_VISIT_TIME,
          TIMEZONE,
          sub.customer_id,
          sub.property_id,
          sub.id,
          periodId,
          sub.status === "pending_payment" ? "pending_payment" : "scheduled",
          // Which cleaning of the period this is. Stored rather than derived,
          // because a member moving the second one earlier must not turn it
          // into the first.
          wanted.indexOf(date),
        ],
      );
      visitsCreated++;
    }

    // Keep the ledger in step with what is actually on the calendar. A
    // skipped visit still counts against the allotment; only a cancelled one
    // gives it back.
    await client.query(
      `update subscription_periods
          set visits_used = least(
            visits_allotted,
            (select count(*) from visits
              where period_id = $1 and status <> 'canceled')
          )
        where id = $1`,
      [periodId],
    );
  }

  return { periodsCreated, visitsCreated };
}

/**
 * A scheduled rate change swaps in at the first period starting on or after
 * its effective date. Until then the member keeps the rate snapshotted on
 * their subscription, which is what grandfathers early members.
 */
export function rateForPeriod(sub: SubscriptionRow, period: Period): number {
  if (
    sub.pending_amount_cents !== null &&
    sub.pending_amount_effective_on !== null &&
    isOnOrAfter(period.start, sub.pending_amount_effective_on)
  ) {
    return sub.pending_amount_cents;
  }
  return sub.monthly_amount_cents;
}

/** The daily cron entry point. Safe to run repeatedly. */
export async function generateUpcomingVisits(
  from: ISODate = today(),
): Promise<{ subscriptions: number; periodsCreated: number; visitsCreated: number }> {
  return transaction(async (client) => {
    // Settle any rate change whose date has arrived, before anything reads a
    // rate. Nothing did this before, so pending_amount_cents sat there for
    // ever and monthly_amount_cents kept the signup price. A member who
    // changed size twice then had the second change fall back to what they
    // paid on day one, because rateForPeriod only trusts pending when the
    // period starts on or after its effective date, and by then the first
    // change was in the past.
    //
    // Collapsing it here means every reader sees one number that is simply
    // true, rather than each having to reimplement the same precedence.
    await client.query(
      `update subscriptions
          set monthly_amount_cents = pending_amount_cents,
              pending_amount_cents = null,
              pending_amount_effective_on = null,
              updated_at = now()
        where pending_amount_cents is not null
          and pending_amount_effective_on is not null
          and pending_amount_effective_on <= $1::date`,
      [from],
    );

    const { rows: subs } = await client.query<SubscriptionRow>(
      `select id, customer_id, property_id, status, monthly_amount_cents,
              visits_per_period, pet_surcharge_cents, preferred_weekday,
              preferred_weekday_second,
              started_on::text as started_on, billing_day, interval_days,
              pending_amount_cents, pending_amount_effective_on::text
                as pending_amount_effective_on,
              ends_on::text as ends_on
         from subscriptions
        where status in ('active', 'pending_cancellation')`,
    );

    let periodsCreated = 0;
    let visitsCreated = 0;
    for (const sub of subs) {
      const result = await generateForSubscription(client, sub, from);
      periodsCreated += result.periodsCreated;
      visitsCreated += result.visitsCreated;
    }

    return { subscriptions: subs.length, periodsCreated, visitsCreated };
  });
}

/**
 * Claim the period's one free add-on.
 *
 * The row lock is the entire point. Without `for update`, two requests a few
 * milliseconds apart both read free_addon_used = false, both pass the check,
 * and the member gets two free ovens. That is a real race on a booking form
 * with a double-click, not a theoretical one.
 */
export async function claimFreePerk(
  client: PoolClient,
  periodId: string,
  visitId: string,
  addOnId: string,
): Promise<{ claimed: boolean; reason?: string }> {
  const { rows } = await client.query<{ free_addon_used: boolean }>(
    `select free_addon_used from subscription_periods where id = $1 for update`,
    [periodId],
  );

  const period = rows[0];
  if (!period) return { claimed: false, reason: "period_not_found" };
  if (period.free_addon_used) return { claimed: false, reason: "already_claimed" };

  const eligible = await client.query<{ free_perk_eligible: boolean; price_cents: number }>(
    `select free_perk_eligible, price_cents from add_ons where id = $1`,
    [addOnId],
  );
  if (!eligible.rows[0]?.free_perk_eligible) {
    return { claimed: false, reason: "not_eligible" };
  }

  await client.query(
    `insert into visit_add_ons (visit_id, add_on_id, price_cents_at_time, is_free_perk)
     values ($1, $2, 0, true)
     on conflict (visit_id, add_on_id) do update set price_cents_at_time = 0,
                                                     is_free_perk = true`,
    [visitId, addOnId],
  );

  await client.query(
    `update subscription_periods set free_addon_used = true where id = $1`,
    [periodId],
  );

  return { claimed: true };
}

/**
 * Cancellation with 14 days' notice.
 *
 * With 14+ days left in the current period, service ends at that period's
 * end. Otherwise it runs through the following period. Either way the
 * subscription moves to `pending_cancellation` and keeps generating visits
 * until `ends_on`, it is never deleted.
 */
export function cancellationEndDate(
  sub: SubscriptionRow,
  requestedOn: ISODate = today(),
): ISODate {
  const period = periodContaining(sub, requestedOn);
  const daysLeft = daysBetween(requestedOn, period.end);
  return daysLeft >= CANCELLATION_NOTICE_DAYS ? period.end : nextPeriod(sub, period).end;
}

export async function requestCancellation(
  client: PoolClient,
  subscriptionId: string,
  requestedOn: ISODate = today(),
): Promise<{ endsOn: ISODate }> {
  const { rows } = await client.query<SubscriptionRow>(
    `select id, customer_id, property_id, status, monthly_amount_cents,
            visits_per_period, pet_surcharge_cents, preferred_weekday,
            preferred_weekday_second,
            started_on::text as started_on, billing_day, interval_days,
            pending_amount_cents, pending_amount_effective_on::text
              as pending_amount_effective_on,
            ends_on::text as ends_on
       from subscriptions where id = $1 for update`,
    [subscriptionId],
  );

  const sub = rows[0];
  if (!sub) throw new Error(`No such subscription: ${subscriptionId}`);

  const endsOn = cancellationEndDate(sub, requestedOn);

  await client.query(
    `update subscriptions
        set status = 'pending_cancellation',
            cancel_requested_at = now(),
            ends_on = $2,
            updated_at = now()
      where id = $1`,
    [subscriptionId, endsOn],
  );

  // Visits already scheduled beyond the end date are no longer owed.
  await client.query(
    `update visits set status = 'canceled'
      where subscription_id = $1
        and status = 'scheduled'
        and scheduled_for >= ($2::date at time zone $3)`,
    [subscriptionId, endsOn, TIMEZONE],
  );

  return { endsOn };
}

/**
 * Schedule an annual rate change. Cannot take effect sooner than the notice
 * period we promised in the service agreement.
 */
export function earliestRateChangeDate(from: ISODate = today()): ISODate {
  return addDays(from, RATE_CHANGE_NOTICE_DAYS);
}
