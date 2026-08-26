import { query, queryOne } from "./db";
import { TIMEZONE } from "./dates";

/**
 * The numbers worth looking at, and deliberately not the ones that only look
 * impressive.
 *
 * Every figure here is one that changes a decision. Revenue against costs
 * tells you whether the pricing works. Recurring value tells you what next
 * month looks like before it arrives. Unassigned visits and unanswered quotes
 * are work about to go wrong. A count of page views is not on here, because
 * knowing it would not make anybody do anything differently.
 *
 * Money is only ever counted from completed work and settled bookings. A
 * pending_payment visit is a hope, and a dashboard that counts hopes as
 * revenue is one you stop trusting the first time somebody abandons checkout.
 */

export type Metrics = {
  revenue: {
    thisMonthCents: number;
    lastMonthCents: number;
    oneOffCents: number;
    recurringCents: number;
    crewCostCents: number;
  };
  recurring: {
    active: number;
    monthlyValueCents: number;
    endingSoon: number;
  };
  leads: {
    open: number;
    thisMonth: number;
    wonThisMonth: number;
    oldestOpenDays: number | null;
  };
  work: {
    completedThisMonth: number;
    upcoming: number;
    unassigned: number;
    overdue: number;
  };
  owed: { cleaners: number; totalCents: number };
  /**
   * Work that has been done and not paid for, from a job agreed before the
   * money arrived. The one number that has nowhere else to surface: the
   * customer is gone, the cleaner has been paid, and nothing chases it.
   */
  unpaid: { jobs: number; totalCents: number };
};

/**
 * Revenue is taken from what a visit actually charged, and a recurring visit
 * charges nothing of its own: the money lives on the subscription. Counting
 * the visit row alone would report every membership month as zero, which is
 * the same trap the crew payouts hit.
 */
const VISIT_VALUE = `
  case
    when v.base_amount_cents + v.pet_surcharge_cents + v.addons_amount_cents > 0
      then v.base_amount_cents + v.pet_surcharge_cents + v.addons_amount_cents
    when s.monthly_amount_cents is not null
      then s.monthly_amount_cents / greatest(s.visits_per_period, 1)
    else 0
  end`;

export async function loadMetrics(): Promise<Metrics> {
  const money = await queryOne<{
    this_month: number;
    last_month: number;
    one_off: number;
    recurring: number;
    crew_cost: number;
  }>(
    `with completed as (
       select v.id, v.origin::text as origin,
              (v.completed_at at time zone $1)::date as done_on,
              ${VISIT_VALUE} as value_cents
         from visits v
         left join subscriptions s on s.id = v.subscription_id
        where v.status = 'completed' and v.completed_at is not null
     ),
     month_start as (
       select date_trunc('month', (now() at time zone $1)::date)::date as m
     )
     select
       coalesce(sum(value_cents) filter (where done_on >= (select m from month_start)), 0)::int as this_month,
       coalesce(sum(value_cents) filter (
         where done_on >= (select m from month_start) - interval '1 month'
           and done_on <  (select m from month_start)), 0)::int as last_month,
       coalesce(sum(value_cents) filter (
         where origin = 'one_off' and done_on >= (select m from month_start)), 0)::int as one_off,
       coalesce(sum(value_cents) filter (
         where origin = 'membership' and done_on >= (select m from month_start)), 0)::int as recurring,
       coalesce((
         select sum(vc.pay_cents) from visit_cleaners vc
          join completed c2 on c2.id = vc.visit_id
         where c2.done_on >= (select m from month_start)
       ), 0)::int as crew_cost
     from completed`,
    [TIMEZONE],
  );

  const recurring = await queryOne<{
    active: number;
    value_cents: number;
    ending_soon: number;
  }>(
    `select
       count(*) filter (where status in ('active', 'paused'))::int as active,
       -- Normalised to a month so two cadences can be added together. A job
       -- every 21 days is worth more per month than the same figure monthly,
       -- and summing the raw amounts would understate it.
       coalesce(sum(
         case
           when status not in ('active', 'paused') then 0
           when interval_days is null then monthly_amount_cents
           else (monthly_amount_cents * 3043) / (interval_days * 100)
         end
       ), 0)::int as value_cents,
       count(*) filter (
         where status = 'pending_cancellation'
            or (ends_on is not null and ends_on >= current_date)
       )::int as ending_soon
     from subscriptions`,
  );

  const leads = await queryOne<{
    open: number;
    this_month: number;
    won_this_month: number;
    oldest_open_days: number | null;
  }>(
    `select
       count(*) filter (where status in ('new', 'quoted'))::int as open,
       count(*) filter (
         where created_at >= date_trunc('month', now() at time zone $1))::int as this_month,
       count(*) filter (
         where status = 'won'
           and updated_at >= date_trunc('month', now() at time zone $1))::int as won_this_month,
       -- How long the longest-waiting request has been sitting. The single
       -- most uncomfortable number here, and the one most worth seeing.
       max(extract(day from now() - created_at))
         filter (where status in ('new', 'quoted'))::int as oldest_open_days
     from enquiries`,
    [TIMEZONE],
  );

  const work = await queryOne<{
    completed_this_month: number;
    upcoming: number;
    unassigned: number;
    overdue: number;
  }>(
    `select
       count(*) filter (
         where status = 'completed'
           and completed_at >= date_trunc('month', now() at time zone $1))::int as completed_this_month,
       count(*) filter (
         where status in ('scheduled', 'assigned')
           and scheduled_for >= now())::int as upcoming,
       -- Scheduled, nobody on it, and happening inside a fortnight. Further
       -- out than that is not yet a problem.
       count(*) filter (
         where status = 'scheduled'
           and scheduled_for between now() and now() + interval '14 days'
           and not exists (select 1 from visit_cleaners vc where vc.visit_id = visits.id)
       )::int as unassigned,
       -- The date has passed and nobody marked it done. Either it did not
       -- happen or the record is wrong, and both need a person.
       count(*) filter (
         where status in ('scheduled', 'assigned')
           and scheduled_for < now() - interval '1 day')::int as overdue
     from visits`,
    [TIMEZONE],
  );

  const owed = await queryOne<{ cleaners: number; total_cents: number }>(
    `select count(distinct vc.cleaner_id)::int as cleaners,
            coalesce(sum(vc.pay_cents), 0)::int as total_cents
       from visit_cleaners vc
       join visits v on v.id = vc.visit_id
      where vc.paid_at is null and v.status = 'completed'`,
  );

  // Cleaned, and still not paid for. Only pay-later jobs can end up here: an
  // ordinary booking is paid before it is ever scheduled. A membership visit
  // counts while its subscription has never reached Stripe, which is what
  // being unpaid means for one.
  const unpaid = await queryOne<{ jobs: number; total_cents: number }>(
    `select count(*)::int as jobs, coalesce(sum(${VISIT_VALUE}), 0)::int as total_cents
       from visits v
       left join subscriptions s on s.id = v.subscription_id
      where v.status = 'completed'
        and v.payment_terms = 'later'
        and case when v.subscription_id is null
                 then v.stripe_payment_intent_id is null
                 else s.stripe_subscription_id is null
            end`,
  );

  return {
    revenue: {
      thisMonthCents: money?.this_month ?? 0,
      lastMonthCents: money?.last_month ?? 0,
      oneOffCents: money?.one_off ?? 0,
      recurringCents: money?.recurring ?? 0,
      crewCostCents: money?.crew_cost ?? 0,
    },
    recurring: {
      active: recurring?.active ?? 0,
      monthlyValueCents: recurring?.value_cents ?? 0,
      endingSoon: recurring?.ending_soon ?? 0,
    },
    leads: {
      open: leads?.open ?? 0,
      thisMonth: leads?.this_month ?? 0,
      wonThisMonth: leads?.won_this_month ?? 0,
      oldestOpenDays: leads?.oldest_open_days ?? null,
    },
    work: {
      completedThisMonth: work?.completed_this_month ?? 0,
      upcoming: work?.upcoming ?? 0,
      unassigned: work?.unassigned ?? 0,
      overdue: work?.overdue ?? 0,
    },
    owed: { cleaners: owed?.cleaners ?? 0, totalCents: owed?.total_cents ?? 0 },
    unpaid: { jobs: unpaid?.jobs ?? 0, totalCents: unpaid?.total_cents ?? 0 },
  };
}

/** Recent months, for a trend that a single figure cannot show. */
export async function revenueByMonth(months = 6): Promise<
  { month: string; cents: number }[]
> {
  return query<{ month: string; cents: number }>(
    `select to_char(date_trunc('month', v.completed_at at time zone $1), 'Mon') as month,
            coalesce(sum(${VISIT_VALUE}), 0)::int as cents
       from visits v
       left join subscriptions s on s.id = v.subscription_id
      where v.status = 'completed'
        and v.completed_at >= date_trunc('month', now() at time zone $1)
                              - ($2 || ' months')::interval
      group by date_trunc('month', v.completed_at at time zone $1)
      order by date_trunc('month', v.completed_at at time zone $1)`,
    [TIMEZONE, String(months - 1)],
  );
}
