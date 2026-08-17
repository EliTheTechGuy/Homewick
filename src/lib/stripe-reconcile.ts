import { query } from "./db";
import { stripe, isStripeConfigured } from "./stripe";
import { alertOwner } from "./alert";
import { formatCents } from "./money";
import { unitSizeLabel, type UnitSize } from "./pricing";

/**
 * Put right any rate change that never reached Stripe.
 *
 * Changing apartment size writes to the database and then tells Stripe. If
 * that second call fails, the two disagree: we think the member pays one
 * amount and Stripe charges another, and the member has been told our number
 * in writing.
 *
 * The action flags it and this clears it. A Stripe outage therefore delays a
 * rate change by up to a day rather than losing it silently, which is the
 * difference between a slow system and a wrong one.
 *
 * Runs from the daily job, after visits are generated, because a billing
 * mismatch is worth fixing but not at the cost of the schedule.
 */
export async function reconcileStripeRates(): Promise<{
  attempted: number;
  fixed: number;
}> {
  if (!isStripeConfigured()) return { attempted: 0, fixed: 0 };

  const pending = await query<{
    id: string;
    unit_size: UnitSize;
    stripe_subscription_id: string;
    amount_cents: number;
  }>(
    `select id, unit_size, stripe_subscription_id,
            coalesce(pending_amount_cents, monthly_amount_cents) as amount_cents
       from subscriptions
      where stripe_sync_needed_at is not null
        and stripe_subscription_id is not null
        and status <> 'canceled'`,
  );

  if (pending.length === 0) return { attempted: 0, fixed: 0 };

  const s = stripe();
  let fixed = 0;

  for (const sub of pending) {
    try {
      const existing = await s.subscriptions.retrieve(sub.stripe_subscription_id);
      const item = existing.items.data[0];
      if (!item) throw new Error("subscription has no item to reprice");

      // Already correct means an earlier attempt did land and only the flag
      // was left behind, which is worth clearing without touching Stripe.
      if (item.price.unit_amount !== sub.amount_cents) {
        const found = await s.products.search({
          query: `active:'true' AND metadata['homewick_unit_size']:'${sub.unit_size}'`,
          limit: 1,
        });
        const productId =
          found.data[0]?.id ??
          (
            await s.products.create({
              name: `Homewick Membership, ${unitSizeLabel(sub.unit_size)}`,
              metadata: { homewick_unit_size: sub.unit_size },
            })
          ).id;

        await s.subscriptions.update(sub.stripe_subscription_id, {
          items: [
            {
              id: item.id,
              price_data: {
                currency: "usd",
                unit_amount: sub.amount_cents,
                recurring: { interval: "month" },
                product: productId,
              },
            },
          ],
          proration_behavior: "none",
        });
      }

      await query(
        `update subscriptions set stripe_sync_needed_at = null, updated_at = now()
          where id = $1`,
        [sub.id],
      );
      fixed++;
    } catch (err) {
      // Left flagged so tomorrow tries again. Only shout once it has been
      // failing long enough to be a real problem rather than a blip.
      console.error(`[billing] could not reconcile ${sub.stripe_subscription_id}`, err);
    }
  }

  const stillBroken = pending.length - fixed;
  if (stillBroken > 0) {
    await alertOwner(
      "A rate change still has not reached Stripe",
      `${stillBroken} membership${stillBroken === 1 ? "" : "s"} changed price here but ` +
        `Stripe is still billing the old amount, and an automatic retry has just ` +
        `failed again.\n\n` +
        pending
          .map(
            (p) =>
              `  ${p.stripe_subscription_id} should be ${formatCents(p.amount_cents)} a month`,
          )
          .join("\n") +
        `\n\nWorth setting these by hand in the Stripe dashboard.`,
    );
  }

  return { attempted: pending.length, fixed };
}
