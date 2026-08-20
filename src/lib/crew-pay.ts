/**
 * What a crew is paid for a house.
 *
 * Half the job price goes to the people who did it, split evenly, with the
 * lead taking a flat premium off the top first. Apartments do not use this:
 * they are one cleaner on their own percentage, and always have been.
 *
 * Integer cents throughout. Money in floating point is how a payout ends up
 * a penny out and nobody can say why.
 */

/** Share of the job price that goes to the crew. */
export const LABOR_POOL_RATE = 0.5;

/** Flat amount the lead takes before the rest is divided, in cents. */
export const LEAD_PREMIUM_CENTS = 1500;

export type CrewMember = { cleanerId: string; isLead: boolean };
export type Payout = { cleanerId: string; isLead: boolean; payCents: number };

/**
 * Split a house job across its crew.
 *
 * A solo cleaner is the lead and takes the whole pool: there is nobody to take
 * a premium relative to, and paying them $15 plus the remainder would come to
 * the same number by a longer route.
 *
 * Shares round down to the cent and the leftover pennies go to the lead, so
 * the payouts always sum to exactly the pool. Dividing $95.00 three ways
 * cannot be done evenly, and money that vanishes into rounding is money
 * somebody worked for.
 */
export function splitHousePay(priceCents: number, crew: CrewMember[]): Payout[] {
  if (crew.length === 0) return [];

  const pool = Math.round(priceCents * LABOR_POOL_RATE);
  const leads = crew.filter((c) => c.isLead);
  if (leads.length !== 1) {
    throw new Error(`a crew needs exactly one lead, got ${leads.length}`);
  }

  if (crew.length === 1) {
    return [{ cleanerId: crew[0].cleanerId, isLead: true, payCents: pool }];
  }

  // The premium comes off before the split, so it is genuinely extra rather
  // than something the others are quietly funding twice over.
  const remainder = pool - LEAD_PREMIUM_CENTS;

  // A pool smaller than the premium would hand the lead more than the job
  // earned and leave the rest owing nothing. Refuse rather than produce a
  // number that looks calculated.
  if (remainder < 0) {
    throw new Error(
      `job price ${priceCents} is too small to carry the lead premium across a crew`,
    );
  }

  const share = Math.floor(remainder / crew.length);
  const leftover = remainder - share * crew.length;

  return crew.map((c) => ({
    cleanerId: c.cleanerId,
    isLead: c.isLead,
    payCents: c.isLead ? LEAD_PREMIUM_CENTS + share + leftover : share,
  }));
}

/**
 * What one visit is worth, which is not always what the visit row says.
 *
 * A one-off carries its own price. A recurring visit does not: the money lives
 * on the subscription, and the visit is created with base_amount_cents at its
 * default of zero. Reading the visit alone would make every recurring job pay
 * its crew half of nothing.
 */
export function visitPriceCents(input: {
  baseCents: number;
  petSurchargeCents: number;
  addOnsCents: number;
  subscriptionAmountCents: number | null;
  visitsPerPeriod: number | null;
}): number {
  const own = input.baseCents + input.petSurchargeCents + input.addOnsCents;
  if (own > 0) return own;

  if (input.subscriptionAmountCents == null) return 0;
  const per = Math.max(1, input.visitsPerPeriod ?? 1);
  return Math.floor(input.subscriptionAmountCents / per);
}
