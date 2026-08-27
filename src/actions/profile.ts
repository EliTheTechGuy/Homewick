"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { transaction, query } from "@/lib/db";
import { currentMember } from "@/lib/member-auth";
import { encryptSecret } from "@/lib/secrets";
import { stripe, isStripeConfigured } from "@/lib/stripe";
import { DEFAULT_VISIT_TIME, formatLong, today, type ISODate } from "@/lib/dates";
import { nextPeriod, periodContaining } from "@/lib/membership-lifecycle";
import {
  UNIT_SIZES,
  frequencyForVisits,
  membershipPrice,
  unitSizeLabel,
  type UnitSize,
} from "@/lib/pricing";
import { formatCents } from "@/lib/money";
import { alertOwner } from "@/lib/alert";
import { membershipProductId } from "@/lib/stripe-products";

const UNIT_SIZE_IDS = UNIT_SIZES.map((u) => u.id) as [UnitSize, ...UnitSize[]];

type Result = { ok: boolean; message: string };

/** Form fields arrive as null when unrendered, and Zod optional wants undefined. */
function field(form: FormData, name: string): string | undefined {
  const raw = form.get(name);
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return trimmed === "" ? undefined : trimmed;
}

const addressSchema = z.object({
  line1: z.string().trim().min(1, "Street address is required").max(200),
  line2: z.string().trim().max(200).optional(),
  city: z.string().trim().min(1, "City is required").max(120),
  state: z.string().trim().length(2).default("TX"),
  postalCode: z.string().trim().regex(/^\d{5}(-\d{4})?$/, "Enter a valid ZIP code"),
  hasPets: z.boolean().default(false),
  parkingNotes: z.string().trim().max(500).optional(),
  entryMethod: z.enum(["lobby", "gate_code", "door_code", "key_location"]),
  entryDetail: z.string().trim().max(200).optional(),
});

/**
 * Move an existing membership to a new address.
 *
 * The old property row is kept and marked inactive rather than edited. Visits
 * point at a property, so rewriting the address in place would silently change
 * where we say last month's cleanings happened. A move is a new place, so it
 * gets a new row and the history stays true.
 *
 * Entry details deliberately do not carry over. A door code from the old
 * apartment is at best useless at the new one, and at worst it is someone
 * else's front door.
 */
export async function updateAddress(form: FormData): Promise<Result> {
  const member = await currentMember();
  if (!member) return { ok: false, message: "Please sign in again." };

  const parsed = addressSchema.safeParse({
    line1: field(form, "line1"),
    line2: field(form, "line2"),
    city: field(form, "city"),
    state: field(form, "state") ?? "TX",
    postalCode: field(form, "postalCode"),
    hasPets: form.get("hasPets") === "on",
    parkingNotes: field(form, "parkingNotes"),
    entryMethod: field(form, "entryMethod") ?? "lobby",
    entryDetail: field(form, "entryDetail"),
  });

  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, message: first?.message ?? "Please check the address." };
  }
  const input = parsed.data;

  if (input.entryMethod !== "lobby" && !input.entryDetail) {
    return { ok: false, message: "Add the code or key location so we can get in." };
  }

  try {
    return await transaction(async (client) => {
      const { rows } = await client.query<{
        id: string;
        property_id: string;
        unit_size: UnitSize;
      }>(
        `select id, property_id, unit_size
           from subscriptions
          where customer_id = $1 and status <> 'canceled'
          order by created_at desc
          limit 1
          for update`,
        [member.customerId],
      );

      const sub = rows[0];
      if (!sub) {
        return { ok: false as const, message: "We could not find your membership." };
      }

      const { rows: created } = await client.query<{ id: string }>(
        `insert into properties
           (customer_id, line1, line2, city, state, postal_code, unit_size,
            has_pets, parking_notes)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         returning id`,
        [
          member.customerId,
          input.line1,
          input.line2 ?? null,
          input.city,
          input.state.toUpperCase(),
          input.postalCode,
          sub.unit_size,
          input.hasPets,
          input.parkingNotes ?? null,
        ],
      );
      const propertyId = created[0].id;

      if (input.entryMethod !== "lobby") {
        const entry = encryptSecret(input.entryDetail);
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

      await client.query(`update properties set is_active = false where id = $1`, [
        sub.property_id,
      ]);
      await client.query(
        `update subscriptions set property_id = $2, updated_at = now() where id = $1`,
        [sub.id, propertyId],
      );

      // Cleanings that have not happened yet belong at the new address.
      // Completed ones stay pointed at the old property, because that is
      // where they actually happened.
      await client.query(
        `update visits
            set property_id = $2
          where subscription_id = $1
            and status = 'scheduled'
            and scheduled_for >= now()`,
        [sub.id, propertyId],
      );

      revalidatePath("/account");
      return {
        ok: true as const,
        message: "Address updated. Your upcoming cleanings are already at the new place.",
      };
    });
  } catch (err) {
    console.error("[account] address change failed", err);
    return { ok: false, message: "That did not save. Please try again." };
  }
}

/**
 * Change apartment size on an existing membership.
 *
 * The new rate starts at the next billing period rather than immediately. The
 * member has already paid for this month, and taking a mid-month top-up charge
 * for a change they made themselves is how you turn a routine update into a
 * chargeback. Downsizing costs us the rest of the month, upsizing gains us the
 * rest of the month, and over any real membership it evens out.
 *
 * The size itself changes now, because the cleaner needs to be scoped for the
 * home they are actually walking into.
 */
export async function changeMembershipSize(newSize: unknown): Promise<Result> {
  const member = await currentMember();
  if (!member) return { ok: false, message: "Please sign in again." };

  const size = z.enum(UNIT_SIZE_IDS).safeParse(newSize);
  if (!size.success) return { ok: false, message: "Choose an apartment size." };

  try {
    const outcome = await transaction(async (client) => {
      const { rows } = await client.query<{
        id: string;
        property_id: string;
        unit_size: UnitSize;
        monthly_amount_cents: number;
        visits_per_period: number;
        pet_surcharge_cents: number;
        preferred_weekday: number | null;
        preferred_weekday_second: number | null;
        started_on: ISODate;
        billing_day: number;
        interval_days: number | null;
        stripe_subscription_id: string | null;
      }>(
        `select id, property_id, unit_size, monthly_amount_cents, visits_per_period,
                pet_surcharge_cents, preferred_weekday, preferred_weekday_second,
                started_on::text as started_on, billing_day, interval_days,
                stripe_subscription_id
           from subscriptions
          where customer_id = $1 and status <> 'canceled'
          order by created_at desc
          limit 1
          for update`,
        [member.customerId],
      );

      const sub = rows[0];
      if (!sub) {
        return { ok: false as const, message: "We could not find your membership." };
      }
      if (sub.unit_size === size.data) {
        return { ok: false as const, message: "That is already your membership." };
      }

      // A custom cadence was priced by hand and has no published rate to move
      // to. Without this a house on an agreed $145 could set itself to the
      // 3 bed apartment rate by clicking a radio button, and the first anybody
      // would know is the invoice.
      //
      // Enforced here as well as hidden in the UI, because a hidden button is
      // not a guard: this is a server action and can be called directly.
      if (sub.interval_days != null) {
        return {
          ok: false as const,
          message:
            "Your schedule was arranged with us directly, so it is not on the published sizes. Get in touch and we will sort it.",
        };
      }

      // Repriced onto their own tier, not onto the headline one. A once-a-month
      // member moving from a 2 bed to a 3 bed owes the once-a-month 3 bed rate.
      // Looking the rate up by size alone would have moved them to $369 for a
      // single cleaning a month, and the first they would know is the invoice.
      const frequency = frequencyForVisits(sub.visits_per_period);
      if (!frequency) {
        return {
          ok: false as const,
          message:
            "Your membership was arranged with us directly, so it is not on the published sizes. Get in touch and we will sort it.",
        };
      }
      const newRate = membershipPrice(frequency, size.data).monthlyCents;

      // Built once and shared, so the period this change lands in and the
      // period after it are measured against the same subscription. Passing
      // interval_days through matters: a custom cadence has different
      // boundaries, and a rate change must take effect on one of its
      // boundaries rather than on a month that never occurs for them.
      const row = {
        id: sub.id,
        customer_id: member.customerId,
        property_id: sub.property_id,
        status: "active" as const,
        monthly_amount_cents: sub.monthly_amount_cents,
        visits_per_period: sub.visits_per_period,
        pet_surcharge_cents: sub.pet_surcharge_cents,
        preferred_weekday: sub.preferred_weekday,
        preferred_weekday_second: sub.preferred_weekday_second,
        started_on: sub.started_on,
        billing_day: sub.billing_day,
        interval_days: sub.interval_days,
        // Only used to work out period boundaries, which do not depend on it.
        payment_terms: "on_booking" as const,
        visit_time: DEFAULT_VISIT_TIME,
        pending_amount_cents: null,
        pending_amount_effective_on: null,
        ends_on: null,
      };
      const effectiveOn = nextPeriod(row, periodContaining(row, today())).start;

      await client.query(
        `update subscriptions
            set unit_size = $2,
                pending_amount_cents = $3,
                pending_amount_effective_on = $4,
                updated_at = now()
          where id = $1`,
        [sub.id, size.data, newRate, effectiveOn],
      );

      await client.query(`update properties set unit_size = $2 where id = $1`, [
        sub.property_id,
        size.data,
      ]);

      return {
        ok: true as const,
        message: `Changed to ${unitSizeLabel(size.data)}. Your rate becomes ${formatCents(newRate)} a month from ${formatLong(effectiveOn)}, and this month is unchanged.`,
        stripeSubscriptionId: sub.stripe_subscription_id,
        subscriptionId: sub.id,
        effectiveOn,
        newRate,
        size: size.data,
        frequency,
      };
    });

    let synced = false;
    if (outcome.ok && outcome.stripeSubscriptionId && isStripeConfigured()) {
      // Stripe is what actually charges the card, so the database alone
      // changing nothing is worse than not offering this at all.
      try {
        const s = stripe();
        const existing = await s.subscriptions.retrieve(outcome.stripeSubscriptionId);
        const item = existing.items.data[0];
        if (item) {
          const productId = await membershipProductId(outcome.size, outcome.frequency);

          await s.subscriptions.update(outcome.stripeSubscriptionId, {
            items: [
              {
                id: item.id,
                price_data: {
                  currency: "usd",
                  unit_amount: outcome.newRate,
                  recurring: { interval: "month" },
                  product: productId,
                },
              },
            ],
            // No mid-cycle top-up or credit. The new rate simply applies to
            // the next invoice, which is what the member was told.
            proration_behavior: "none",
          });
        }
        synced = true;
      } catch (err) {
        console.error(
          "[account] size changed in database but Stripe still bills the old rate",
          outcome.stripeSubscriptionId,
          err,
        );
      }
    }

    // A rate the member has been promised but Stripe has not been told about
    // is the worst state this action can end in, so it is written down rather
    // than logged. The daily job retries it, and the owner is told now.
    if (outcome.ok && outcome.stripeSubscriptionId && !synced) {
      await query(
        `update subscriptions set stripe_sync_needed_at = now() where id = $1`,
        [outcome.subscriptionId],
      ).catch((err) => console.error("[account] could not flag a failed sync", err));

      await alertOwner(
        "Rate change did not reach Stripe",
        `A membership size change saved here but Stripe was not updated, so it is still billing the old amount.\n\n` +
          `Subscription: ${outcome.stripeSubscriptionId}\n` +
          `Should now be: ${formatCents(outcome.newRate)} a month from ${formatLong(outcome.effectiveOn)}\n\n` +
          `It will be retried automatically by the daily job. Nothing is needed from you unless this keeps arriving.`,
      );
    }

    revalidatePath("/account");

    // The member is only promised a price we know Stripe will charge.
    if (outcome.ok && outcome.stripeSubscriptionId && !synced) {
      return {
        ok: true,
        message: `Changed to ${unitSizeLabel(outcome.size)}. We are still confirming the new rate with our payment provider and will email you once it is set.`,
      };
    }

    return { ok: outcome.ok, message: outcome.message };
  } catch (err) {
    console.error("[account] size change failed", err);
    return { ok: false, message: "That did not save. Please try again." };
  }
}
