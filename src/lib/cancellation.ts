/**
 * What it costs to call off a one-time clean.
 *
 * A cancellation fee here is not a charge. One-time cleans are paid at
 * booking, so the money is already ours and calling something off is a partial
 * refund: give back everything except the fee. That matters more than it
 * sounds. Charging a card after the fact means storing it, charging it
 * off-session, and losing the argument when the authentication fails or the
 * customer disputes a payment they did not expect. Keeping part of a payment
 * they already authorised has none of that.
 *
 * Memberships do not come through here. A membership period is paid in
 * advance and is not refunded on a partial basis, which the service agreement
 * has always said, so the fee is already built into how it works.
 */

/** Notice needed to call off a clean and get everything back. */
export const CANCELLATION_NOTICE_HOURS = 48;

/**
 * Kept when a clean is called off inside that window.
 *
 * Flat rather than a percentage, deliberately. Half of a $280 deep clean is
 * $140, and a number that size is what turns an awkward phone call into a
 * chargeback, which costs more than the fee and takes the payment with it.
 * Flat is also the only version somebody can repeat back to you correctly.
 *
 * It is roughly a cleaner's trip. Inside two days the slot is gone and
 * somebody has usually already been told to be there.
 */
export const LATE_CANCELLATION_FEE_CENTS = 4000;

export type Cancellation = {
  /** Whether this is inside the notice window. */
  late: boolean;
  /** Kept by us. Zero when there is enough notice. */
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
  const late = hoursUntil < CANCELLATION_NOTICE_HOURS;

  // The fee can never exceed what was paid. A $35 laundry-only visit called
  // off late owes $35, not $40, and a refund cannot be negative: that would
  // be an extra charge nobody agreed to.
  const feeCents = late ? Math.min(LATE_CANCELLATION_FEE_CENTS, input.paidCents) : 0;

  return {
    late,
    feeCents,
    refundCents: input.paidCents - feeCents,
    hoursUntil,
  };
}
