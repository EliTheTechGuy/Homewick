import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { query } from "@/lib/db";
import { isStripeConfigured, stripe } from "@/lib/stripe";

/**
 * Stripe webhook. Stripe owns billing state; this endpoint copies the parts we
 * need to join on — customer and subscription IDs, invoice IDs, and the
 * subscription's status — back onto our rows.
 *
 * The signature check is not optional: without it anyone who knows the URL can
 * mark subscriptions active.
 */

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isStripeConfigured()) {
    return NextResponse.json({ error: "Stripe is not configured." }, { status: 503 });
  }

  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "STRIPE_WEBHOOK_SECRET is not set." },
      { status: 503 },
    );
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing signature." }, { status: 400 });
  }

  // The raw body is required — parsing it first invalidates the signature.
  const payload = await request.text();

  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(payload, signature, secret);
  } catch (err) {
    console.error("Stripe signature verification failed", err);
    return NextResponse.json({ error: "Invalid signature." }, { status: 400 });
  }

  try {
    await handle(event);
  } catch (err) {
    // A non-2xx tells Stripe to retry, which is what we want on a transient
    // database failure.
    console.error(`Failed handling ${event.type}`, err);
    return NextResponse.json({ error: "Handler failed." }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

async function handle(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object;
      const customerId = typeof session.customer === "string" ? session.customer : null;
      const subscriptionId =
        typeof session.subscription === "string" ? session.subscription : null;

      if (session.metadata?.kind === "membership" && session.metadata.subscription_id) {
        await query(
          `update subscriptions
              set stripe_subscription_id = coalesce($2, stripe_subscription_id),
                  status = 'active',
                  updated_at = now()
            where id = $1`,
          [session.metadata.subscription_id, subscriptionId],
        );

        if (customerId) {
          await query(
            `update customers set stripe_customer_id = $2, updated_at = now()
              where id = (select customer_id from subscriptions where id = $1)`,
            [session.metadata.subscription_id, customerId],
          );
        }
      }

      if (session.metadata?.kind === "one_time" && session.metadata.visit_id) {
        const paymentIntent =
          typeof session.payment_intent === "string" ? session.payment_intent : null;
        await query(
          `update visits set stripe_payment_intent_id = $2 where id = $1`,
          [session.metadata.visit_id, paymentIntent],
        );

        if (customerId) {
          await query(
            `update customers set stripe_customer_id = $2, updated_at = now()
              where id = (select customer_id from visits where id = $1)`,
            [session.metadata.visit_id, customerId],
          );
        }
      }
      break;
    }

    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const subscription = event.data.object;
      // Stripe's cancellation is the end of the story, but our own
      // pending_cancellation state carries the notice period, so we do not
      // overwrite it with 'canceled' until Stripe actually ends the sub.
      const status =
        event.type === "customer.subscription.deleted" || subscription.status === "canceled"
          ? "canceled"
          : subscription.status === "paused"
            ? "paused"
            : "active";

      await query(
        `update subscriptions
            set status = case
                  when status = 'pending_cancellation' and $2 <> 'canceled'
                    then status
                  else $2::subscription_state
                end,
                updated_at = now()
          where stripe_subscription_id = $1`,
        [subscription.id, status],
      );
      break;
    }

    case "invoice.paid": {
      const invoice = event.data.object;
      const subscriptionId = subscriptionIdFrom(invoice);
      if (!subscriptionId) break;

      // Attach the invoice to the period it covers, so admin can jump from a
      // month's entitlement to the charge behind it.
      await query(
        `update subscription_periods sp
            set stripe_invoice_id = $2
           from subscriptions s
          where sp.subscription_id = s.id
            and s.stripe_subscription_id = $1
            and sp.stripe_invoice_id is null
            and sp.period_start <= current_date
            and sp.period_end > current_date`,
        [subscriptionId, invoice.id],
      );
      break;
    }

    case "invoice.payment_failed": {
      // Stripe's dunning handles retries and customer emails. We only note it.
      console.warn("Invoice payment failed", event.data.object.id);
      break;
    }

    default:
      break;
  }
}

/** The subscription reference moved onto invoice line items in recent API versions. */
function subscriptionIdFrom(invoice: Stripe.Invoice): string | null {
  const direct = (invoice as unknown as { subscription?: string | { id: string } })
    .subscription;
  if (typeof direct === "string") return direct;
  if (direct && typeof direct === "object") return direct.id;

  for (const line of invoice.lines?.data ?? []) {
    const parent = (
      line as unknown as {
        parent?: { subscription_item_details?: { subscription?: string } };
      }
    ).parent;
    const fromLine = parent?.subscription_item_details?.subscription;
    if (typeof fromLine === "string") return fromLine;
  }
  return null;
}
