import { query, queryOne } from "./db";
import { DEFAULT_VISIT_TIME, TIMEZONE, today } from "./dates";
import { subscriptionIncludesFreeAddOn, type UnitSize } from "./pricing";
import { cancellationEndDate } from "./membership-lifecycle";
import { cancellationFor, type CancellationTier } from "./cancellation";

/** Everything the member's account page renders, in two queries. */

/**
 * What cancelling a listed visit would cost, worked out once for both callers.
 *
 * Null on a membership cleaning, which has nothing to refund. The number is
 * computed here rather than in the browser so that what somebody is shown and
 * what the server does are the same calculation.
 */
function cancellationFields(v: {
  origin: string;
  scheduled_for: Date;
  paid_cents: number;
}): Pick<UpcomingVisit, "isOneOff" | "cancellation"> {
  if (v.origin !== "one_off") return { isOneOff: false, cancellation: null };
  const money = cancellationFor({
    paidCents: v.paid_cents,
    scheduledFor: v.scheduled_for,
    now: new Date(),
  });
  return {
    isOneOff: true,
    cancellation: {
      refundCents: money.refundCents,
      feeCents: money.feeCents,
      tier: money.tier,
    },
  };
}

export type UpcomingVisit = {
  id: string;
  onDate: string;
  weekday: string;
  status: string;
  inCurrentPeriod: boolean;
  /**
   * Last date this cleaning may be moved to, exclusive. Cleanings cannot cross
   * into the next billing period, so the picker needs the boundary to stop a
   * member choosing a date the server will only reject.
   */
  periodEndsOn: string | null;
  /**
   * A one-off is a purchase and can be cancelled for a refund. A membership
   * cleaning is one of the ones the period already paid for, so cancelling it
   * owes nobody anything and the member moves it instead.
   */
  isOneOff: boolean;
  /**
   * What cancelling it right now would give back, and what it would keep.
   * Worked out here rather than in the browser so the number somebody agrees
   * to is the number the server will use.
   */
  cancellation: {
    refundCents: number;
    feeCents: number;
    tier: CancellationTier;
  } | null;
};

export type MemberOverview = {
  subscription: {
    id: string;
    status: string;
    monthlyAmountCents: number;
    /**
     * Null on a house. Houses are quoted on square footage and have no
     * apartment bracket, which the schema has allowed since houses arrived.
     * This was typed as always present, so the account page rendered an empty
     * label and a dangling separator to exactly the customers who were
     * entered by hand.
     */
    unitSize: UnitSize | null;
    /**
     * Null is the published monthly membership. A value means a cadence
     * arranged by hand, which changes what the amount above actually means:
     * it is charged every this-many days, not every month.
     */
    intervalDays: number | null;
    /** Cleanings the period includes, which is what tells the two tiers apart. */
    visitsPerPeriod: number;
    /**
     * Whether this membership includes the free monthly add-on, after any
     * decision made for this customer specifically. Resolved here so the
     * account page and the server action cannot disagree about it.
     */
    freeAddOnIncluded: boolean;
    endsOn: string | null;
    /**
     * What the end date would be if they cancelled today. Shown before they
     * confirm, because "cancel" means different things depending on where in
     * the billing period they are, and finding that out afterwards feels like
     * a trick.
     */
    wouldEndOn: string;
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
  /** Where we currently clean. Null for a customer with no membership. */
  property: {
    id: string;
    line1: string;
    line2: string | null;
    city: string;
    state: string;
    postalCode: string;
    hasPets: boolean;
    parkingNotes: string | null;
  } | null;
  /**
   * A rate change already agreed but not yet charged. Members who change
   * apartment size need to see the new price and the date it starts, or the
   * next invoice looks like a mistake.
   */
  pendingRate: { amountCents: number; effectiveOn: string } | null;
};

export async function memberOverview(customerId: string): Promise<MemberOverview> {
  const sub = await queryOne<{
    id: string;
    status: string;
    monthly_amount_cents: number;
    unit_size: UnitSize;
    ends_on: string | null;
    started_on: string;
    billing_day: number;
    interval_days: number | null;
    visits_per_period: number;
    free_add_on_override: boolean | null;
    pet_surcharge_cents: number;
    preferred_weekday: number | null;
    stripe_customer_id: string | null;
    pending_amount_cents: number | null;
    pending_amount_effective_on: string | null;
    property_id: string;
    line1: string;
    line2: string | null;
    city: string;
    state: string;
    postal_code: string;
    has_pets: boolean;
    parking_notes: string | null;
  }>(
    `select s.id, s.status::text as status, s.monthly_amount_cents, s.unit_size,
            s.ends_on::text as ends_on, s.started_on::text as started_on,
            s.billing_day, s.interval_days, s.visits_per_period, s.free_add_on_override,
            s.pet_surcharge_cents,
            s.preferred_weekday, c.stripe_customer_id,
            s.pending_amount_cents,
            s.pending_amount_effective_on::text as pending_amount_effective_on,
            p.id as property_id, p.line1, p.line2, p.city, p.state,
            p.postal_code, p.has_pets, p.parking_notes
       from subscriptions s
       join customers c on c.id = s.customer_id
       join properties p on p.id = s.property_id
      where s.customer_id = $1
        and s.status in ('active', 'paused', 'pending_cancellation')
      order by s.created_at desc
      limit 1`,
    [customerId],
  );

  const upcomingRows = await query<{
    id: string;
    on_date: string;
    weekday: string;
    status: string;
    origin: string;
    scheduled_for: Date;
    paid_cents: number;
    period_id: string | null;
    period_end: string | null;
  }>(
    `select v.id,
            (v.scheduled_for at time zone $2)::date::text as on_date,
            to_char(v.scheduled_for at time zone $2, 'Dy') as weekday,
            v.status::text as status,
            v.origin::text as origin,
            v.scheduled_for,
            (v.base_amount_cents + v.pet_surcharge_cents + v.addons_amount_cents)
              as paid_cents,
            v.period_id,
            sp.period_end::text as period_end
       from visits v
       left join subscription_periods sp on sp.id = v.period_id
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
        periodEndsOn: v.period_end,
        ...cancellationFields(v),
      })),
      hasStripeCustomer: false,
      property: null,
      pendingRate: null,
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
  // period, claiming it against a completed clean would be meaningless.
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

  // A scheduled rate change stops being "pending" once its date arrives, but
  // monthly_amount_cents keeps the old figure, since the period ledger reads
  // the pending column instead. Resolving it here means the member is never
  // shown a price they have already stopped paying.
  const rateChangeLive =
    sub.pending_amount_cents !== null &&
    sub.pending_amount_effective_on !== null &&
    sub.pending_amount_effective_on <= today();

  return {
    subscription: {
      id: sub.id,
      status: sub.status,
      monthlyAmountCents: rateChangeLive
        ? sub.pending_amount_cents!
        : sub.monthly_amount_cents,
      unitSize: sub.unit_size,
      /** Null is the ordinary monthly membership. A value is a custom cadence. */
      intervalDays: sub.interval_days,
      visitsPerPeriod: sub.visits_per_period,
      freeAddOnIncluded: subscriptionIncludesFreeAddOn({
        intervalDays: sub.interval_days,
        visitsPerPeriod: sub.visits_per_period,
        freeAddOnOverride: sub.free_add_on_override,
      }),
      endsOn: sub.ends_on,
      wouldEndOn: cancellationEndDate({
        id: sub.id,
        customer_id: customerId,
        property_id: "",
        status: "active",
        interval_days: sub.interval_days,
        // Boundary arithmetic only.
        payment_terms: "on_booking" as const,
        visit_time: DEFAULT_VISIT_TIME,
        monthly_amount_cents: sub.monthly_amount_cents,
        visits_per_period: sub.visits_per_period,
        pet_surcharge_cents: sub.pet_surcharge_cents,
        preferred_weekday: sub.preferred_weekday,
        preferred_weekday_second: null,
        started_on: sub.started_on,
        billing_day: sub.billing_day,
        pending_amount_cents: null,
        pending_amount_effective_on: null,
        ends_on: null,
      }),
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
      periodEndsOn: v.period_end,
      ...cancellationFields(v),
    })),
    hasStripeCustomer: Boolean(sub.stripe_customer_id),
    property: {
      id: sub.property_id,
      line1: sub.line1,
      line2: sub.line2,
      city: sub.city,
      state: sub.state,
      postalCode: sub.postal_code,
      hasPets: sub.has_pets,
      parkingNotes: sub.parking_notes,
    },
    pendingRate:
      !rateChangeLive &&
      sub.pending_amount_cents !== null &&
      sub.pending_amount_effective_on !== null
        ? {
            amountCents: sub.pending_amount_cents,
            effectiveOn: sub.pending_amount_effective_on,
          }
        : null,
  };
}
