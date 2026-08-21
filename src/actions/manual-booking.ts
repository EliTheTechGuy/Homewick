"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { transaction } from "@/lib/db";
import { requireAdmin } from "@/lib/admin-auth";
import { encryptSecret } from "@/lib/secrets";
import { today } from "@/lib/dates";
import { UNIT_SIZES, type UnitSize } from "@/lib/pricing";
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
  | { ok: true; message: string; checkoutUrl?: string }
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
              customer_instructions)
           values ($1, $2, 'one_off', $3, 'pending_payment',
                   ($4::date + time '09:00') at time zone 'America/Chicago',
                   $5, 0, 0, $6)
           returning id`,
          [
            customerId,
            propertyId,
            input.serviceType,
            input.startsOn,
            input.amountCents,
            input.notes || null,
          ],
        );
        return { kind: "one_time" as const, id: rows[0].id };
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
            interval_days, created_by)
         values ($1, $2, $3, 'pending_payment', $4, $5, 0, $6, $7, $8, $9)
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
        ],
      );
      return { kind: "membership" as const, id: rows[0].id };
    });

    // Outside the transaction: a Stripe outage must not roll back a customer
    // record that was entered correctly. Worst case the link is missing and
    // can be regenerated.
    const session = await createCheckoutSession(ref.id, ref.kind);

    revalidatePath("/admin");
    revalidatePath("/admin/members");

    if ("error" in session) {
      return {
        ok: true,
        message: `Saved, but the payment link could not be created: ${session.error}`,
      };
    }

    const cadence =
      input.plan === "recurring"
        ? `every ${input.intervalDays} days at ${money(input.amountCents)}`
        : `one visit at ${money(input.amountCents)}`;

    return {
      ok: true,
      message: `${input.firstName} is in, ${cadence}. Send them the payment link to activate it.`,
      checkoutUrl: session.url,
    };
  } catch (err) {
    console.error("[admin] manual booking failed", err);
    return { ok: false, message: "That did not save. Please try again." };
  }
}
