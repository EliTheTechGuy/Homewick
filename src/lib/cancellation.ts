/**
 * What it costs to call off a one-time clean.
 *
 * A cancellation fee here is not a charge. One-time cleans are paid at
 * booking, so the money is already ours and calling something off is a partial
 * refund: give back everything except the fee. That matters more than it
 * sounds. Charging a card after the fact means storing it, charging it
 * off-session, and losing the argument when the authentication fails or the
 * customer disputes a payment they did not expect. Keeping part of one they
 * already authorised has none of that.
 *
 * Memberships do not come through here. A membership period is paid in
 * advance and is not refunded on a partial basis, which the service agreement
 * has always said, so the fee is already built into how it works.
 */

/** Notice that costs nothing. */
export const FREE_CANCELLATION_HOURS = 48;

/** Below this, the visit is not refunded at all. */
export const NO_REFUND_HOURS = 24;

/**
 * The share of the visit kept at each level of notice.
 *
 * A share rather than a flat amount, so the fee tracks the size of the job.
 * Calling off a $110 studio the night before costs less than calling off a
 * $399 move-out, which is the right shape: what is lost is the visit, and the
 * visits are not worth the same.
 */
export const CANCELLATION_FEE_RATES = {
  /** 48 hours or more. */
  free: 0,
  /** Between 24 and 48 hours. */
  half: 0.5,
  /** Under 24 hours, including a lockout on the day. */
  full: 1,
} as const;

export type CancellationTier = keyof typeof CANCELLATION_FEE_RATES;

export type Cancellation = {
  tier: CancellationTier;
  /** Kept by us. */
  feeCents: number;
  /** Given back to the customer. */
  refundCents: number;
  /** Whole hours until the visit, floored. Negative once it is in the past. */
  hoursUntil: number;
};

/**
 * Work out the refund, in cents.
 *
 * Both times are absolute instants, so there is no timezone arithmetic to get
 * wrong here: a visit at 9am in Texas is one moment, and the question is only
 * how far away it is from now.
 *
 * A visit already in the past lands in the full tier, which is what a lockout
 * is. The cleaner travelled, the hour is gone, and there is nothing left to
 * resell.
 */
export function cancellationFor(input: {
  /** What the customer actually paid for this visit. */
  paidCents: number;
  scheduledFor: Date;
  now: Date;
}): Cancellation {
  const hoursUntil = Math.floor(
    (input.scheduledFor.getTime() - input.now.getTime()) / 3_600_000,
  );

  const tier: CancellationTier =
    hoursUntil >= FREE_CANCELLATION_HOURS
      ? "free"
      : hoursUntil >= NO_REFUND_HOURS
        ? "half"
        : "full";

  // Floored, so a half that does not divide evenly leaves the odd cent with
  // the customer rather than with us. It is one cent, and it is the sort of
  // thing that is only ever noticed when it went the wrong way.
  const feeCents = Math.floor(input.paidCents * CANCELLATION_FEE_RATES[tier]);

  return {
    tier,
    feeCents,
    refundCents: input.paidCents - feeCents,
    hoursUntil,
  };
}
