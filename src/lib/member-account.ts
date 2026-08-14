import { query, queryOne } from "./db";
import { TIMEZONE } from "./dates";
import type { UnitSize } from "./pricing";

/** Everything the member's account page renders, in two queries. */

export type UpcomingVisit = {
  id: string;
  onDate: string;
  weekday: string;
  status: string;
  inCurrentPeriod: boolean;
};

export type MemberOverview = {
  subscription: {
    id: string;
    status: string;
    monthlyAmountCents: number;
    unitSize: UnitSize;
    endsOn: string | null;
  } | null;
  currentPeriod: {
    id: string;
    startsOn: string;
    endsOn: string;
    visitsUsed: number;
    visitsAllotted: number;
    freeAddOnUsed: boolean;
  } | null;
  /** The visit a newly claimed free add-on would attach to. */
  claimableVisitId: string | null;
  claimedAddOnName: string | null;
  upcoming: UpcomingVisit[];
  hasStripeCustomer: boolean;
};

export async function memberOverview(customerId: string): Promise<MemberOverview> {
  const sub = await queryOne<{
    id: string;
    status: string;
    monthly_amount_cents: number;
    unit_size: UnitSize;
    ends_on: string | null;
    stripe_customer_id: string | null;
  }>(
    `select s.id, s.status::text as status, s.monthly_amount_cents, s.unit_size,
            s.ends_on::text as ends_on, c.stripe_customer_id
       from subscriptions s
       join customers c on c.id = s.customer_id
      where s.customer_id = $1 and s.status <> 'canceled'
      order by s.created_at desc
      limit 1`,
    [customerId],
  );

  const upcomingRows = await query<{
    id: string;
    on_date: string;
    weekday: string;
    status: string;
    period_id: string | null;
  }>(
    `select v.id,
            (v.scheduled_for at time zone $2)::date::text as on_date,
            to_char(v.scheduled_for at time zone $2, 'Dy') as weekday,
            v.status::text as status,
            v.period_id
       from visits v
      where v.customer_id = $1
        and v.status in ('scheduled', 'assigned')
        and v.scheduled_for >= now()
      order by v.scheduled_for
      limit 6`,
    [customerId, TIMEZONE],
  );

  if (!sub) {
    return {
      subscription: null,
      currentPeriod: null,
      claimableVisitId: null,
      claimedAddOnName: null,
      upcoming: upcomingRows.map((v) => ({
        id: v.id,
        onDate: v.on_date,
        weekday: v.weekday,
        status: v.status,
        inCurrentPeriod: false,
      })),
      hasStripeCustomer: false,
    };
  }

  // The period today falls inside. period_end is exclusive.
  const period = await queryOne<{
    id: string;
    period_start: string;
    period_end: string;
    visits_used: number;
    visits_allotted: number;
    free_addon_used: boolean;
  }>(
    `select id, period_start::text, period_end::text, visits_used, visits_allotted,
            free_addon_used
       from subscription_periods
      where subscription_id = $1
        and period_start <= (now() at time zone $2)::date
        and period_end   >  (now() at time zone $2)::date
      limit 1`,
    [sub.id, TIMEZONE],
  );

  // A perk has to land on a visit that has not happened yet, inside this
  // period — claiming it against a completed clean would be meaningless.
  const claimable = period
    ? await queryOne<{ id: string }>(
        `select id from visits
          where period_id = $1 and status = 'scheduled' and scheduled_for >= now()
          order by scheduled_for
          limit 1`,
        [period.id],
      )
    : null;

  const claimed = period
    ? await queryOne<{ name: string }>(
        `select a.name from visit_add_ons va
           join add_ons a on a.id = va.add_on_id
           join visits v on v.id = va.visit_id
          where v.period_id = $1 and va.is_free_perk
          limit 1`,
        [period.id],
      )
    : null;

  return {
    subscription: {
      id: sub.id,
      status: sub.status,
      monthlyAmountCents: sub.monthly_amount_cents,
      unitSize: sub.unit_size,
      endsOn: sub.ends_on,
    },
    currentPeriod: period
      ? {
          id: period.id,
          startsOn: period.period_start,
          endsOn: period.period_end,
          visitsUsed: period.visits_used,
          visitsAllotted: period.visits_allotted,
          freeAddOnUsed: period.free_addon_used,
        }
      : null,
    claimableVisitId: claimable?.id ?? null,
    claimedAddOnName: claimed?.name ?? null,
    upcoming: upcomingRows.map((v) => ({
      id: v.id,
      onDate: v.on_date,
      weekday: v.weekday,
      status: v.status,
      inCurrentPeriod: Boolean(period && v.period_id === period.id),
    })),
    hasStripeCustomer: Boolean(sub.stripe_customer_id),
  };
}
