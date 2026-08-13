"use server";

import type Stripe from "stripe";
import { queryOne } from "@/lib/db";
import { isStripeConfigured, stripe } from "@/lib/stripe";
import { site } from "@/lib/site";
import { unitSizeLabel, type UnitSize } from "@/lib/pricing";

/**
 * Creates a Stripe Checkout session for a booking that is already in the
 * database. Card details are collected by Stripe, never by us.
 *
 * Membership uses subscription mode so Stripe Billing owns the recurring
 * charge, proration, and dunning. The onboarding deep clean rides along as a
 * one-off line item — it is billed separately from the monthly rate rather
 * than folded into the first month.
 */
export async function createCheckoutSession(
  bookingRef: string,
  kind: "membership" | "one_time",
): Promise<{ url: string } | { error: string }> {
  if (!isStripeConfigured()) {
    // Stripe is not wired up yet — the booking is saved, so send the customer
    // to the confirmation page rather than failing in front of them.
    return { url: `/book/confirmed?ref=${encodeURIComponent(bookingRef)}` };
  }

  try {
    return kind === "membership"
      ? await membershipSession(bookingRef)
      : await oneOffSession(bookingRef);
  } catch (err) {
    console.error("Stripe checkout failed", err);
    return { error: "We could not reach the payment provider. Please try again." };
  }
}

type CustomerRow = {
  customer_id: string;
  email: string;
  stripe_customer_id: string | null;
};

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

  // The onboarding deep clean, already scheduled as a one-off visit.
  const deepClean = await queryOne<{ id: string; base_amount_cents: number }>(
    `select id, base_amount_cents from visits
      where customer_id = $1 and origin = 'one_off' and service_type = 'deep'
      order by created_at desc limit 1`,
    [row.customer_id],
  );

  const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [
    {
      quantity: 1,
      price_data: {
        currency: "usd",
        unit_amount: row.monthly_amount_cents,
        recurring: { interval: "month" },
        product_data: {
          name: `Homewick Membership — ${unitSizeLabel(row.unit_size)}`,
          description: "Two cleanings per billing period, one free add-on each period.",
        },
      },
    },
  ];

  if (deepClean && deepClean.base_amount_cents > 0) {
    lineItems.push({
      quantity: 1,
      price_data: {
        currency: "usd",
        unit_amount: deepClean.base_amount_cents,
        product_data: {
          name: "Onboarding deep clean (15% member discount)",
        },
      },
    });
  }

  const session = await stripe().checkout.sessions.create({
    mode: "subscription",
    line_items: lineItems,
    customer: row.stripe_customer_id ?? undefined,
    customer_email: row.stripe_customer_id ? undefined : row.email,
    success_url: `${site.url}/book/confirmed?ref=${subscriptionId}&session_id={CHECKOUT_SESSION_ID}`,
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
          product_data: { name: "Homewick Cleaning — one-time visit" },
        },
      },
    ],
    customer: row.stripe_customer_id ?? undefined,
    customer_email: row.stripe_customer_id ? undefined : row.email,
    success_url: `${site.url}/book/confirmed?ref=${visitId}&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${site.url}/book?canceled=1`,
    metadata: { kind: "one_time", visit_id: visitId },
  });

  return session.url ? { url: session.url } : { error: "Stripe did not return a URL." };
}
