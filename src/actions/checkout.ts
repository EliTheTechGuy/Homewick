"use server";

import type Stripe from "stripe";
import { queryOne } from "@/lib/db";
import { isStripeConfigured, stripe } from "@/lib/stripe";
import { membershipProductId } from "@/lib/stripe-products";
import { site } from "@/lib/site";
import {
  MEMBER_FIRST_MONTH_DISCOUNT,
  unitSizeLabel,
  type UnitSize,
} from "@/lib/pricing";

/**
 * Creates a Stripe Checkout session for a booking that is already in the
 * database. Card details are collected by Stripe, never by us.
 *
 * Membership uses subscription mode so Stripe Billing owns the recurring
 * charge, proration, and dunning. The onboarding deep clean rides along as a
 * one-off line item, it is billed separately from the monthly rate rather
 * than folded into the first month.
 */
export async function createCheckoutSession(
  bookingRef: string,
  kind: "membership" | "one_time",
): Promise<{ url: string } | { error: string }> {
  // The booking row already exists by the time we get here, so the customer
  // must not be sent back to the form, they would submit it a second time.
  // Instead they go to the confirmation page, which says plainly that payment
  // is outstanding. Silently showing the ordinary "Booking received" page put
  // an unpaid visit on the calendar and told the customer they were done.
  const unpaid = `/book/confirmed?ref=${encodeURIComponent(bookingRef)}&payment=pending`;

  if (!isStripeConfigured()) {
    console.error(
      "Checkout skipped: STRIPE_SECRET_KEY is not set. Booking",
      bookingRef,
      "is saved but unpaid.",
    );
    return { url: unpaid };
  }

  try {
    return kind === "membership"
      ? await membershipSession(bookingRef)
      : await oneOffSession(bookingRef);
  } catch (err) {
    console.error(`Stripe checkout failed for booking ${bookingRef}`, err);
    return { url: unpaid };
  }
}

type CustomerRow = {
  customer_id: string;
  email: string;
  stripe_customer_id: string | null;
};

/**
 * The new-member discount, as a Stripe coupon.
 *
 * Created once and then reused by a fixed id, so repeated signups do not
 * litter the account with identical coupons. Stripe has no upsert for these,
 * so this retrieves first and creates only when it is genuinely absent.
 */
/**
 * The welcome discount, restricted to the membership itself.
 *
 * Applied to the whole session it also came off the pet surcharge and any
 * add-ons, because in subscription mode those become items on the same first
 * invoice. The site quoted a 2 bed signup with pets and one add-on at $275.15
 * while Stripe charged $268.17. The customer was undercharged, the $15 pet
 * surcharge was really $12.75, and the member add-on discount was silently
 * 23.5% instead of 10%.
 *
 * applies_to fixes it, and cannot be changed after creation, hence the v2 in
 * the id: the old coupon still exists and still discounts everything, so it
 * has to be left behind rather than edited.
 */
async function firstMonthCoupon(products: string[]): Promise<string> {
  const id = `homewick-first-month-${Math.round(MEMBER_FIRST_MONTH_DISCOUNT * 100)}-v2`;
  const s = stripe();

  try {
    await s.coupons.retrieve(id);
    return id;
  } catch {
    await s.coupons.create({
      id,
      percent_off: MEMBER_FIRST_MONTH_DISCOUNT * 100,
      duration: "once",
      name: "New member, first month",
      applies_to: { products },
    });
    return id;
  }
}

async function membershipSession(subscriptionId: string) {
  const row = await queryOne<
    CustomerRow & { unit_size: UnitSize; monthly_amount_cents: number }
  >(
    `select s.customer_id, s.unit_size, s.monthly_amount_cents,
            c.email, c.stripe_customer_id
       from subscriptions s
       join customers c on c.id = s.customer_id
      where s.id = $1`,
    [subscriptionId],
  );
  if (!row) return { error: "That booking could not be found." };

  // The one-time pet surcharge rides on the member's first cleaning, which is
  // their onboarding deep clean. Every chargeable component is read back, not
  // just the headline rate, reading only the base once quoted a pet home
  // $487.15 and charged $472.15.
  const firstVisit = await queryOne<{ pet_surcharge_cents: number }>(
    `select pet_surcharge_cents from visits
      where subscription_id = $1
      order by scheduled_for
      limit 1`,
    [subscriptionId],
  );

  // Paid add-ons ride on the member's first scheduled cleaning. The free perk
  // is stored at zero, so it contributes nothing here by construction.
  const addOns = await queryOne<{ total: number }>(
    `select coalesce(sum(va.price_cents_at_time), 0)::int as total
       from visit_add_ons va
       join visits v on v.id = va.visit_id
      where v.subscription_id = $1`,
    [subscriptionId],
  );

  const productId = await membershipProductId(row.unit_size);

  const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [
    {
      quantity: 1,
      price_data: {
        currency: "usd",
        unit_amount: row.monthly_amount_cents,
        recurring: { interval: "month" },
        product: productId,
      },
    },
  ];

  if (firstVisit && firstVisit.pet_surcharge_cents > 0) {
    lineItems.push({
      quantity: 1,
      price_data: {
        currency: "usd",
        unit_amount: firstVisit.pet_surcharge_cents,
        product_data: { name: "Pet home surcharge (one-time)" },
      },
    });
  }

  if (addOns && addOns.total > 0) {
    lineItems.push({
      quantity: 1,
      price_data: {
        currency: "usd",
        unit_amount: addOns.total,
        product_data: { name: "Add-ons" },
      },
    });
  }

  const session = await stripe().checkout.sessions.create({
    mode: "subscription",
    line_items: lineItems,
    // The first month is discounted; every month after is the full rate. A
    // once-duration coupon is how Stripe expresses that, and it keeps the
    // recurring price honest, the subscription really is $269/month, so a
    // rate change later does not have to unpick a bespoke first invoice.
    discounts: [{ coupon: await firstMonthCoupon([productId]) }],
    customer: row.stripe_customer_id ?? undefined,
    customer_email: row.stripe_customer_id ? undefined : row.email,
    success_url: `${site.url}/book/confirmed/paid?ref=${subscriptionId}&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${site.url}/book?canceled=1`,
    metadata: { kind: "membership", subscription_id: subscriptionId },
    subscription_data: {
      metadata: { subscription_id: subscriptionId, customer_id: row.customer_id },
    },
  });

  return session.url ? { url: session.url } : { error: "Stripe did not return a URL." };
}

async function oneOffSession(visitId: string) {
  const row = await queryOne<
    CustomerRow & {
      base_amount_cents: number;
      pet_surcharge_cents: number;
      addons_amount_cents: number;
      service_type: string;
    }
  >(
    `select v.customer_id, v.base_amount_cents, v.pet_surcharge_cents,
            v.addons_amount_cents, v.service_type::text as service_type,
            c.email, c.stripe_customer_id
       from visits v
       join customers c on c.id = v.customer_id
      where v.id = $1`,
    [visitId],
  );
  if (!row) return { error: "That booking could not be found." };

  const total =
    row.base_amount_cents + row.pet_surcharge_cents + row.addons_amount_cents;

  const session = await stripe().checkout.sessions.create({
    mode: "payment",
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: total,
          product_data: { name: "Homewick Cleaning, one-time visit" },
        },
      },
    ],
    customer: row.stripe_customer_id ?? undefined,
    customer_email: row.stripe_customer_id ? undefined : row.email,
    success_url: `${site.url}/book/confirmed/paid?ref=${visitId}&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${site.url}/book?canceled=1`,
    metadata: { kind: "one_time", visit_id: visitId },
    // A promotion code box on the one-time checkout, so a discount can be run
    // without a deploy: a first-customer offer, a code on a flyer, a goodwill
    // gesture after a clean went wrong.
    //
    // Only on this session, not the membership one. Stripe rejects a session
    // carrying both allow_promotion_codes and discounts, verified against the
    // API rather than assumed, and the membership session needs discounts for
    // the automatic first-month coupon. Offering a code box there would mean
    // giving up the discount every new member already gets.
    //
    // Note that visits still record what was quoted, not what was collected.
    // Stripe remains the source of truth for money, which is the existing
    // design, but it does mean a heavily discounted booking reads at full
    // price in admin. Worth knowing before running a real promotion.
    allow_promotion_codes: true,
  });

  return session.url ? { url: session.url } : { error: "Stripe did not return a URL." };
}
