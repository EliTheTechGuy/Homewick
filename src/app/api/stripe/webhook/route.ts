import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { query, queryOne } from "@/lib/db";
import { TIMEZONE } from "@/lib/dates";
import type { ServiceType, UnitSize } from "@/lib/pricing";
import { sendOnce } from "@/lib/emails/send-once";
import { membershipWelcomeEmail, oneTimeBookingEmail } from "@/lib/emails/templates";
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
  // This endpoint is public, so its replies name nothing. Reporting which
  // variable is missing turns it into a configuration oracle for anyone who
  // curls it — handy for debugging, and no less handy for a stranger.
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!isStripeConfigured() || !secret) {
    console.error(
      "Stripe webhook unavailable: missing",
      [!isStripeConfigured() && "STRIPE_SECRET_KEY", !secret && "STRIPE_WEBHOOK_SECRET"]
        .filter(Boolean)
        .join(", "),
    );
    return NextResponse.json({ error: "Unavailable." }, { status: 503 });
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

        await sendMembershipWelcome(event.id, session.metadata.subscription_id, session);
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

        await sendOneTimeConfirmation(event.id, session.metadata.visit_id, session);
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

/**
 * Confirmation email for a paid one-time booking.
 *
 * Sent from the webhook rather than the booking action, because the booking
 * row exists before payment. Sending at booking time would confirm a cleaning
 * to somebody who then abandoned checkout and was never charged.
 *
 * Email failure must not fail the webhook: a non-2xx makes Stripe retry, and
 * retrying a payment we already recorded to fix an email is the wrong trade.
 */
async function sendOneTimeConfirmation(
  eventId: string,
  visitId: string,
  session: Stripe.Checkout.Session,
): Promise<void> {
  try {
    const row = await queryOne<{
      customer_id: string;
      first_name: string;
      email: string;
      service_type: ServiceType;
      unit_size: UnitSize;
      on_date: string;
      line1: string;
      line2: string | null;
      city: string;
      postal_code: string;
    }>(
      `select c.id as customer_id, c.first_name, c.email::text as email,
              v.service_type, p.unit_size,
              (v.scheduled_for at time zone $2)::date::text as on_date,
              p.line1, p.line2, p.city, p.postal_code
         from visits v
         join customers c on c.id = v.customer_id
         join properties p on p.id = v.property_id
        where v.id = $1`,
      [visitId, TIMEZONE],
    );
    if (!row) return;

    await sendOnce({
      eventKey: eventId,
      kind: "one_time_booking",
      to: row.email,
      customerId: row.customer_id,
      message: oneTimeBookingEmail({
        firstName: row.first_name,
        serviceType: row.service_type,
        unitSize: row.unit_size,
        onDate: row.on_date,
        address: [row.line1, row.line2, `${row.city}, TX ${row.postal_code}`]
          .filter(Boolean)
          .join(", "),
        amountCents: session.amount_total ?? 0,
      }),
    });
  } catch (err) {
    console.error(`[email] one-time confirmation failed for visit ${visitId}`, err);
  }
}

/** Welcome email once a membership's first payment has actually gone through. */
async function sendMembershipWelcome(
  eventId: string,
  subscriptionId: string,
  session: Stripe.Checkout.Session,
): Promise<void> {
  try {
    const row = await queryOne<{
      customer_id: string;
      first_name: string;
      email: string;
      unit_size: UnitSize;
      monthly_amount_cents: number;
      line1: string;
      line2: string | null;
      city: string;
      postal_code: string;
    }>(
      `select c.id as customer_id, c.first_name, c.email::text as email,
              s.unit_size, s.monthly_amount_cents,
              p.line1, p.line2, p.city, p.postal_code
         from subscriptions s
         join customers c on c.id = s.customer_id
         join properties p on p.id = s.property_id
        where s.id = $1`,
      [subscriptionId],
    );
    if (!row) return;

    const visits = await query<{ on_date: string }>(
      `select (scheduled_for at time zone $2)::date::text as on_date
         from visits
        where subscription_id = $1 and status = 'scheduled'
        order by scheduled_for
        limit 2`,
      [subscriptionId, TIMEZONE],
    );

    await sendOnce({
      eventKey: eventId,
      kind: "membership_welcome",
      to: row.email,
      customerId: row.customer_id,
      message: membershipWelcomeEmail({
        firstName: row.first_name,
        unitSize: row.unit_size,
        monthlyAmountCents: row.monthly_amount_cents,
        firstPaymentCents: session.amount_total ?? 0,
        visitDates: visits.map((v) => v.on_date),
        address: [row.line1, row.line2, `${row.city}, TX ${row.postal_code}`]
          .filter(Boolean)
          .join(", "),
      }),
    });
  } catch (err) {
    console.error(`[email] membership welcome failed for ${subscriptionId}`, err);
  }
}
