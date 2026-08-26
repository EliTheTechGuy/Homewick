"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { transaction } from "@/lib/db";
import { requireAdmin } from "@/lib/admin-auth";
import { encryptSecret } from "@/lib/secrets";
import { today } from "@/lib/dates";
import { propertyLabel, UNIT_SIZES, type ServiceType, type UnitSize } from "@/lib/pricing";
import { sendOnce } from "@/lib/emails/send-once";
import { bookingConfirmedEmail, paymentLinkEmail } from "@/lib/emails/templates";
import { generateForSubscription } from "@/lib/membership-lifecycle";
import { createCheckoutSession } from "./checkout";

/**
 * Enter a customer who did not come through the booking form.
 *
 * Leads arrive by phone, by referral, and from listing platforms, and until
 * now the only thing that could create a customer was the public form. So a
 * real enquiry had nowhere to go.
 *
 * Two shapes, and the difference is billing:
 *
 *   single       one visit, priced here, paid by a link sent to the customer
 *   recurring    a subscription on any cadence in whole days
 *
 * The recurring case is why interval_days exists. Every three weeks does not
 * divide into a month, so it cannot be expressed as a billing_day anchor.
 *
 * No card is taken here. Admin creates the record and gets a Stripe Checkout
 * link to send, and the customer enters their own card exactly as they would
 * on the public form. That keeps every card detail with Stripe, and it means
 * this reuses the same checkout and webhook path that is already proven rather
 * than inventing a second way for a booking to become paid.
 */

type Result =
  | { ok: true; message: string; checkoutUrl?: string; emailed: boolean }
  | { ok: false; message: string };

const schema = z.object({
  firstName: z.string().trim().min(1, "First name is required").max(80),
  lastName: z.string().trim().min(1, "Last name is required").max(80),
  email: z.string().trim().max(200).pipe(z.email("Enter a valid email address")),
  phone: z.string().trim().min(7, "Phone number is required").max(40),

  line1: z.string().trim().min(1, "Street address is required").max(200),
  line2: z.string().trim().max(200).optional(),
  city: z.string().trim().min(1, "City is required").max(120),
  postalCode: z.string().trim().min(5, "ZIP is required").max(12),
  /** Decides which pay model the crew on this job is paid under. */
  propertyKind: z.enum(["apartment", "house"]),
  /** Apartments only. A house has no bracket, and inventing one stores a guess as a fact. */
  unitSize: z.enum(UNIT_SIZES.map((u) => u.id) as [UnitSize, ...UnitSize[]]).optional(),
  /** Houses only. An apartment's size is its unitSize. */
  bedrooms: z.number().int().min(0).max(20).optional(),
  bathrooms: z.number().min(0).max(20).optional(),
  squareFeet: z.number().int().min(100).max(30000).optional(),
  hasPets: z.boolean(),

  entryMethod: z.enum(["gate_code", "door_code", "key_location", "none"]),
  entryDetail: z.string().trim().max(400).optional(),

  plan: z.enum(["single", "recurring"]),
  serviceType: z.enum(["standard", "deep", "move_out"]),
  startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a start date"),
  amountCents: z.number().int().min(100, "Enter an amount").max(500000),

  /** Recurring only. Whole days, so every three weeks is simply 21. */
  intervalDays: z.number().int().min(7).max(365).optional(),
  visitsPerPeriod: z.number().int().min(1).max(10).optional(),
  notes: z.string().trim().max(2000).optional(),

  /**
   * When the payment link goes out.
   *
   * "later" is for the customer who will not pay up front, usually because
   * somebody took their money and did not turn up. The job is agreed and
   * staffed now, and the link is sent nearer the day from their record.
   */
  paymentTerms: z.enum(["on_booking", "later"]).default("on_booking"),
});

export type ManualBookingInput = z.infer<typeof schema>;

function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export async function createManualBooking(raw: unknown): Promise<Result> {
  const admin = await requireAdmin();
  if (!admin) return { ok: false, message: "Not signed in." };

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the details." };
  }
  const input = parsed.data;

  if (input.plan === "recurring" && input.intervalDays == null) {
    return { ok: false, message: "Choose how often they want cleaning." };
  }
  if (input.startsOn < today()) {
    return { ok: false, message: "The start date is in the past." };
  }

  try {
    const ref = await transaction(async (client) => {
      // Matched on email, so entering somebody who already exists updates
      // rather than duplicating. Name and phone are deliberately not
      // overwritten: the record they created themselves is the one they can
      // see and correct in their account.
      const { rows: customerRows } = await client.query<{ id: string }>(
        `insert into customers (first_name, last_name, email, phone)
         values ($1, $2, $3, $4)
         on conflict (email) do update set updated_at = now()
         returning id`,
        [input.firstName, input.lastName, input.email, input.phone],
      );
      const customerId = customerRows[0].id;

      const { rows: propertyRows } = await client.query<{ id: string }>(
        `insert into properties
           (customer_id, line1, line2, city, state, postal_code, unit_size,
            has_pets, property_kind, bedrooms, bathrooms, square_feet)
         values ($1, $2, $3, $4, 'TX', $5, $6, $7, $8, $9, $10, $11)
         returning id`,
        [
          customerId,
          input.line1,
          input.line2 || null,
          input.city,
          input.postalCode,
          // Null on a house. The shape lives in bedrooms, bathrooms and
          // square feet, which are real, rather than a bracket that is not.
          input.propertyKind === "house" ? null : (input.unitSize ?? null),
          input.hasPets,
          // Decides which pay model every crew on this property is paid under,
          // so losing it is not cosmetic: a house would quietly pay its crew
          // on the apartment model.
          input.propertyKind,
          input.propertyKind === "house" ? (input.bedrooms ?? null) : null,
          input.propertyKind === "house" ? (input.bathrooms ?? null) : null,
          input.propertyKind === "house" ? (input.squareFeet ?? null) : null,
        ],
      );
      const propertyId = propertyRows[0].id;

      // Entry details go to the encrypted table, never into general notes.
      const entry =
        input.entryMethod === "none" ? null : encryptSecret(input.entryDetail || null);
      if (entry) {
        await client.query(
          `insert into property_access_secrets
             (property_id, gate_code_enc, door_code_enc, key_location_enc)
           values ($1, $2, $3, $4)`,
          [
            propertyId,
            input.entryMethod === "gate_code" ? entry : null,
            input.entryMethod === "door_code" ? entry : null,
            input.entryMethod === "key_location" ? entry : null,
          ],
        );
      }

      if (input.plan === "single") {
        const { rows } = await client.query<{ id: string }>(
          `insert into visits
             (customer_id, property_id, origin, service_type, status, scheduled_for,
              base_amount_cents, pet_surcharge_cents, addons_amount_cents,
              customer_instructions, payment_terms)
           values ($1, $2, 'one_off', $3, $7::visit_state,
                   ($4::date + time '09:00') at time zone 'America/Chicago',
                   $5, 0, 0, $6, $8::payment_terms)
           returning id`,
          [
            customerId,
            propertyId,
            input.serviceType,
            input.startsOn,
            input.amountCents,
            input.notes || null,
            // Scheduled, not pending_payment. A job somebody is paying for on
            // the day still needs a cleaner sent to it, and the admin board
            // deliberately hides anything pending_payment so that an abandoned
            // checkout never reaches one.
            input.paymentTerms === "later" ? "scheduled" : "pending_payment",
            input.paymentTerms,
          ],
        );
        return { kind: "one_time" as const, id: rows[0].id, customerId };
      }

      // billing_day still has to satisfy its 1 to 28 constraint even though a
      // custom cadence never reads it, so it takes the start date's day,
      // clamped. Writing something meaningless would be worse than writing
      // something ignored but plausible.
      const billingDay = Math.min(Number(input.startsOn.slice(8, 10)), 28);

      const { rows } = await client.query<{ id: string }>(
        `insert into subscriptions
           (customer_id, property_id, unit_size, status, monthly_amount_cents,
            visits_per_period, pet_surcharge_cents, started_on, billing_day,
            interval_days, created_by, payment_terms)
         values ($1, $2, $3, 'pending_payment', $4, $5, 0, $6, $7, $8, $9,
                 $10::payment_terms)
         returning id`,
        [
          customerId,
          propertyId,
          input.propertyKind === "house" ? null : (input.unitSize ?? null),
          input.amountCents,
          input.visitsPerPeriod ?? 1,
          input.startsOn,
          billingDay,
          input.intervalDays,
          admin.actor,
          input.paymentTerms,
        ],
      );
      // A pay-later booking has to be a real job now, not when the money
      // arrives. Nothing else generates visits for a manual subscription: the
      // daily job only looks at active ones, so without this there would be
      // nothing on the board to put a cleaner against, whether the money is
      // coming today or on the day.
      //
      // Done for every manual booking, not only the pay-later ones. Waiting
      // for the daily job cost the customer their agreed date twice over: it
      // does not run until the next morning, and it refuses to schedule
      // anything inside two days, so a first clean agreed for the 27th was
      // being created for the 29th. Somebody would have been told a date
      // nobody was ever going to turn up on.
      //
      // notBefore is the date he actually agreed. The two day floor is right
      // for a generator running unattended and wrong for a date settled on
      // the phone.
      //
      // A pay-now booking still generates its visits as pending_payment, so
      // they stay off the board until Stripe says otherwise and no cleaner is
      // sent to a job nobody has paid for. generateForSubscription reads that
      // from the payment terms below.
      await generateForSubscription(
        client,
        {
          id: rows[0].id,
          customer_id: customerId,
          property_id: propertyId,
          status: "pending_payment",
          monthly_amount_cents: input.amountCents,
          visits_per_period: input.visitsPerPeriod ?? 1,
          pet_surcharge_cents: 0,
          preferred_weekday: null,
          preferred_weekday_second: null,
          started_on: input.startsOn,
          billing_day: billingDay,
          interval_days: input.intervalDays ?? null,
          payment_terms: input.paymentTerms,
          pending_amount_cents: null,
          pending_amount_effective_on: null,
          ends_on: null,
        },
        input.startsOn,
        input.startsOn,
      );

      return { kind: "membership" as const, id: rows[0].id, customerId };
    });

    const cadence =
      input.plan === "recurring"
        ? `every ${input.intervalDays} days at ${money(input.amountCents)}`
        : `one visit at ${money(input.amountCents)}`;

    // Nothing is sent yet when the link is going out later. The job is on the
    // board and can be staffed; the money is collected from their record when
    // he decides to ask for it.
    if (input.paymentTerms === "later") {
      // Confirmed, not invoiced. Somebody who has just been on the phone and
      // written a date in their diary needs that date written down by us too.
      // Sending nothing was the old behaviour and it meant that choosing to
      // collect nearer the day was choosing to go quiet on a customer who had
      // just agreed to something.
      const confirmed = await sendOnce({
        eventKey: `booking_confirmed:${ref.id}`,
        kind: "booking_confirmed",
        to: input.email,
        customerId: ref.customerId,
        message: bookingConfirmedEmail({
          firstName: input.firstName,
          serviceType: input.serviceType as ServiceType,
          onDate: input.startsOn,
          address: [input.line1, input.line2, `${input.city}, TX ${input.postalCode}`]
            .filter(Boolean)
            .join(", "),
          property: propertyLabel({
            unitSize: input.propertyKind === "house" ? null : (input.unitSize ?? null),
            bedrooms: input.bedrooms ?? null,
            bathrooms: input.bathrooms ?? null,
          }),
          amountCents: input.amountCents,
          intervalDays: input.intervalDays ?? null,
          recurring: input.plan === "recurring",
        }),
      }).catch((err) => {
        console.error(`[admin] booking confirmation failed for ${ref.id}`, err);
        return { sent: false as const };
      });

      revalidatePath("/admin");
      revalidatePath("/admin/members");
      return {
        ok: true,
        emailed: confirmed.sent,
        message: confirmed.sent
          ? `${input.firstName} is in, ${cadence}, and has been emailed the details. No payment link yet: send that from the job when you are ready.`
          : `${input.firstName} is in, ${cadence}, but the confirmation email did not send. They have not heard from us, so tell them the date yourself.`,
      };
    }

    // Outside the transaction: a Stripe outage must not roll back a customer
    // record that was entered correctly. Worst case the link is missing and
    // can be regenerated.
    const session = await createCheckoutSession(ref.id, ref.kind);

    revalidatePath("/admin");
    revalidatePath("/admin/members");

    if ("error" in session) {
      return {
        ok: true,
        emailed: false,
        message: `Saved, but the payment link could not be created: ${session.error}`,
      };
    }

    // Sent to the customer rather than handed back for the operator to
    // forward. A raw Stripe URL pasted into a text message is a wall of
    // characters that looks exactly like something you should not click, and
    // it arrives with none of the context the call had.
    //
    // Never allowed to fail the booking. The record is already saved, and the
    // link is returned below so it can still be sent by hand.
    const emailed = await sendOnce({
      eventKey: `manual_booking:${ref.id}`,
      kind: "payment_link",
      to: input.email,
      customerId: ref.customerId,
      message: paymentLinkEmail({
        firstName: input.firstName,
        checkoutUrl: session.url,
        amountCents: input.amountCents,
        serviceType: input.serviceType as ServiceType,
        startsOn: input.startsOn,
        address: [input.line1, input.line2, `${input.city}, TX ${input.postalCode}`]
          .filter(Boolean)
          .join(", "),
        intervalDays: input.intervalDays ?? null,
        recurring: input.plan === "recurring",
      }),
    }).catch((err) => {
      console.error(`[admin] payment link email failed for ${ref.id}`, err);
      return { sent: false as const };
    });

    return {
      ok: true,
      emailed: emailed.sent,
      message: emailed.sent
        ? `${input.firstName} is in, ${cadence}. We have emailed ${input.email} the payment link.`
        : `${input.firstName} is in, ${cadence}, but the email did not send. Send them the link below yourself.`,
      checkoutUrl: session.url,
    };
  } catch (err) {
    console.error("[admin] manual booking failed", err);
    return { ok: false, message: "That did not save. Please try again." };
  }
}
