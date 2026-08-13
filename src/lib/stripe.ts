import Stripe from "stripe";

/**
 * Stripe is the source of truth for money. We store its IDs and ask it when we
 * need billing detail, rather than keeping a second ledger that can disagree.
 *
 * Card data never reaches our servers — everything goes through Checkout,
 * which keeps us at PCI SAQ-A.
 */

let client: Stripe | null = null;

export function stripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error("STRIPE_SECRET_KEY is not set.");
  }
  if (!client) client = new Stripe(key);
  return client;
}

export function isStripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}
