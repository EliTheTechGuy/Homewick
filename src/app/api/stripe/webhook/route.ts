import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { query, queryOne } from "@/lib/db";
import { TIMEZONE } from "@/lib/dates";
import {
  frequencyForVisits,
  membershipTier,
  propertyLabel,
  type ServiceType,
  type UnitSize,
} from "@/lib/pricing";
import { sendOnce } from "@/lib/emails/send-once";
import {
  membershipWelcomeEmail,
  newBookingAlertEmail,
  oneTimeBookingEmail,
} from "@/lib/emails/templates";
import { isStripeConfigured, stripe } from "@/lib/stripe";
import { site } from "@/lib/site";

/**
 * Stripe webhook. Stripe owns billing state; this endpoint copies the parts we
 * need to join on, being customer and subscription IDs, invoice IDs, and the
 * subscription's status, back onto our rows.
 *
 * The signature check is not optional: without it anyone who knows the URL can
 * mark subscriptions active.
 */

export const runtime = "nodejs";

export async function POST(request: Request) {
  // This endpoint is public, so its replies name nothing. Reporting which
  // variable is missing turns it into a configuration oracle for anyone who
  // curls it. Handy for debugging, and no less handy for a stranger.
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

  // The raw body is required, because parsing it first invalidates the signature.
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
        // Payment is what turns a booking into a membership. Only ever
        // promotes forward: a webhook arriving late must not drag a cancelled
        // or ending membership back to active.
        await query(
          `update subscriptions
              set stripe_subscription_id = coalesce($2, stripe_subscription_id),
                  status = case when status = 'pending_payment' then 'active'
                                else status end,
                  updated_at = now()
            where id = $1`,
          [session.metadata.subscription_id, subscriptionId],
        );

        // The visits generated with it were held back for the same reason.
        await query(
          `update visits set status = 'scheduled'
            where subscription_id = $1 and status = 'pending_payment'`,
          [session.metadata.subscription_id],
        );

        if (customerId) {
          await query(
            `update customers set stripe_customer_id = $2, updated_at = now()
              where id = (select customer_id from subscriptions where id = $1)`,
            [session.metadata.subscription_id, customerId],
          );
        }

        await sendMembershipWelcome(event.id, session.metadata.subscription_id, session);

        // The operator gets their own message, keyed on the member's first
        // clean, since that is the job that needs a cleaner against it.
        const first = await queryOne<{ id: string }>(
          `select id from visits
            where subscription_id = $1 and status in ('scheduled', 'assigned')
            order by scheduled_for
            limit 1`,
          [session.metadata.subscription_id],
        );
        if (first) await sendOwnerAlert(event.id, first.id, "membership", session);
      }

      if (session.metadata?.kind === "one_time" && session.metadata.visit_id) {
        const paymentIntent =
          typeof session.payment_intent === "string" ? session.payment_intent : null;
        await query(
          `update visits
              set stripe_payment_intent_id = $2,
                  status = case when status = 'pending_payment' then 'scheduled'
                                else status end
            where id = $1`,
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
        await sendOwnerAlert(event.id, session.metadata.visit_id, "one_time", session);
      }
      break;
    }

    case "checkout.session.expired": {
      // Stripe expires an abandoned session after 24 hours. Without this the
      // unpaid booking would sit in the database for ever, and while nothing
      // schedules it any more, it would still block the customer from booking
      // and clutter every report.
      const session = event.data.object;

      if (session.metadata?.kind === "membership" && session.metadata.subscription_id) {
        await query(
          `update visits set status = 'canceled'
            where subscription_id = $1 and status = 'pending_payment'`,
          [session.metadata.subscription_id],
        );
        await query(
          `update subscriptions
              set status = 'canceled', ends_on = current_date, updated_at = now()
            where id = $1 and status = 'pending_payment'`,
          [session.metadata.subscription_id],
        );
      }

      if (session.metadata?.kind === "one_time" && session.metadata.visit_id) {
        await query(
          `update visits set status = 'canceled'
            where id = $1 and status = 'pending_payment'`,
          [session.metadata.visit_id],
        );
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
      unit_size: UnitSize | null;
      bedrooms: number | null;
      bathrooms: string | null;
      on_date: string;
      line1: string;
      line2: string | null;
      city: string;
      postal_code: string;
    }>(
      `select c.id as customer_id, c.first_name, c.email::text as email,
              v.service_type, p.unit_size, p.bedrooms, p.bathrooms,
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
        property: propertyLabel({
          unitSize: row.unit_size,
          bedrooms: row.bedrooms,
          bathrooms: row.bathrooms,
        }),
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
      unit_size: UnitSize | null;
      bedrooms: number | null;
      bathrooms: string | null;
      monthly_amount_cents: number;
      visits_per_period: number;
      interval_days: number | null;
      line1: string;
      line2: string | null;
      city: string;
      postal_code: string;
    }>(
      `select c.id as customer_id, c.first_name, c.email::text as email,
              s.unit_size, p.bedrooms, p.bathrooms,
              s.monthly_amount_cents, s.visits_per_period, s.interval_days,
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

    // What this membership actually includes, read from the subscription. A
    // hand-agreed cadence belongs to no published tier, and gets the plain
    // version rather than another tier's promises.
    const frequency =
      row.interval_days == null ? frequencyForVisits(row.visits_per_period) : null;

    await sendOnce({
      eventKey: eventId,
      kind: "membership_welcome",
      to: row.email,
      customerId: row.customer_id,
      message: membershipWelcomeEmail({
        firstName: row.first_name,
        property: propertyLabel({
          unitSize: row.unit_size,
          bedrooms: row.bedrooms,
          bathrooms: row.bathrooms,
        }),
        visitsPerPeriod: row.visits_per_period,
        freeAddOn: frequency ? membershipTier(frequency).freeAddOn : false,
        monthlyAmountCents: row.monthly_amount_cents,
        intervalDays: row.interval_days,
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

/**
 * Tell the operator a paid booking has landed.
 *
 * Separate from the customer's confirmation on purpose. That one is a receipt;
 * this one is a job that needs a cleaner against it. Sending on payment rather
 * than on submission means an abandoned checkout never pages anybody.
 *
 * Failure is swallowed. A missing alert costs the operator a look at the board;
 * throwing here would make Stripe retry a payment we have already recorded.
 */
async function sendOwnerAlert(
  eventId: string,
  visitId: string,
  kind: "membership" | "one_time",
  session: Stripe.Checkout.Session,
): Promise<void> {
  if (!site.ownerEmail) return;

  try {
    const row = await queryOne<{
      first_name: string;
      last_name: string;
      phone: string;
      service_type: ServiceType;
      unit_size: UnitSize | null;
      bedrooms: number | null;
      bathrooms: string | null;
      has_pets: boolean;
      on_date: string;
      line1: string;
      line2: string | null;
      city: string;
      postal_code: string;
      customer_instructions: string | null;
      add_ons: string[] | null;
    }>(
      `select c.first_name, c.last_name, c.phone,
              v.service_type, p.unit_size, p.bedrooms, p.bathrooms, p.has_pets,
              (v.scheduled_for at time zone $2)::date::text as on_date,
              p.line1, p.line2, p.city, p.postal_code,
              v.customer_instructions,
              (select array_agg(a.name order by a.sort_order)
                 from visit_add_ons va
                 join add_ons a on a.id = va.add_on_id
                where va.visit_id = v.id) as add_ons
         from visits v
         join customers c on c.id = v.customer_id
         join properties p on p.id = v.property_id
        where v.id = $1`,
      [visitId, TIMEZONE],
    );
    if (!row) return;

    // Keyed separately from the customer's email so one failing does not
    // suppress the other, and so a Stripe retry cannot alert twice.
    await sendOnce({
      eventKey: `${eventId}:owner`,
      kind: "owner_booking_alert",
      to: site.ownerEmail,
      customerId: null,
      message: newBookingAlertEmail({
        kind,
        customerName: `${row.first_name} ${row.last_name}`,
        customerPhone: row.phone,
        serviceType: row.service_type,
        property: propertyLabel({
          unitSize: row.unit_size,
          bedrooms: row.bedrooms,
          bathrooms: row.bathrooms,
        }),
        onDate: row.on_date,
        address: [row.line1, row.line2, `${row.city}, TX ${row.postal_code}`]
          .filter(Boolean)
          .join(", "),
        amountCents: session.amount_total ?? 0,
        hasPets: row.has_pets,
        addOns: row.add_ons ?? [],
        instructions: row.customer_instructions,
        adminUrl: `${site.url}/admin?date=${row.on_date}`,
      }),
    });
  } catch (err) {
    console.error(`[email] owner alert failed for visit ${visitId}`, err);
  }
}
