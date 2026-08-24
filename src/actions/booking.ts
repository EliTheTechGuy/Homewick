"use server";

import { headers } from "next/headers";
import { bookingSchema, quoteBooking, type BookingInput } from "@/lib/booking-schema";
import { transaction, timestamptzFromLocal, isDatabaseConfigured } from "@/lib/db";
import { encryptSecret, isSecretKeyConfigured } from "@/lib/secrets";
import {
  DEFAULT_VISIT_TIME,
  TIMEZONE,
  addDays,
  firstWeekdayOnOrAfter,
  today,
} from "@/lib/dates";
import {
  MIN_LEAD_DAYS,
  generateForSubscription,
  type SubscriptionRow,
} from "@/lib/membership-lifecycle";
import {
  DEEP_CLEAN_INCLUDES,
  PET_SURCHARGE_CENTS,
  SERVICE_PRICES,
  includedInService,
  membershipPrice,
  membershipTier,
  onboardingServiceType,
} from "@/lib/pricing";
import { TERMS_VERSION } from "@/lib/site";

export type BookingResult =
  | {
      ok: true;
      bookingRef: string;
      kind: "membership" | "one_time";
      totalCents: number;
    }
  | { ok: false; fieldErrors: Record<string, string>; formError?: string };

/**
 * Persists a booking.
 *
 * Ordering matters: everything lands in one transaction so a half-created
 * customer with no property cannot survive a failure partway through.
 */
export async function submitBooking(raw: unknown): Promise<BookingResult> {
  const parsed = bookingSchema.safeParse(raw);

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.join(".");
      if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return { ok: false, fieldErrors };
  }

  const input = parsed.data;

  if (!isDatabaseConfigured() || !isSecretKeyConfigured()) {
    // The customer gets a plain apology; the operator gets the actual cause in
    // the logs. Naming environment variables on a public page tells a visitor
    // nothing useful and tells everyone else how the deployment is wired.
    console.error(
      "Booking rejected, missing configuration:",
      [
        !isDatabaseConfigured() && "DATABASE_URL",
        !isSecretKeyConfigured() && "ACCESS_SECRET_KEY",
      ]
        .filter(Boolean)
        .join(", "),
    );
    return {
      ok: false,
      fieldErrors: {},
      formError:
        "Online booking is temporarily unavailable. Nothing has been charged, so please try again shortly.",
    };
  }

  const headerList = await headers();
  const ip =
    headerList.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    headerList.get("x-real-ip") ??
    null;
  const userAgent = headerList.get("user-agent");

  const quote = quoteBooking(input);

  try {
    const bookingRef = await transaction(async (client) => {
      // Customer, a repeat booker keeps their existing record.
      //
      // Deliberately does NOT overwrite the name or phone number of somebody
      // who already exists. This form is public and unauthenticated, so anyone
      // who knew a customer's email address could otherwise book under it and
      // silently replace that customer's contact details. The admin view
      // renders the phone number as click to call, so the failure mode was a
      // cleaner standing at a customer's door ringing a stranger.
      //
      // A genuine change of name or number now goes through the account, where
      // the person has proved they control the address.
      //
      // Consent is only ever added, never withdrawn: a booking submitted
      // without the box ticked is not an instruction to stop texting.
      const { rows: customerRows } = await client.query<{ id: string }>(
        `insert into customers (first_name, last_name, email, phone, sms_consent_at)
         values ($1, $2, $3, $4, $5)
         on conflict (email) do update
           set sms_consent_at = coalesce(excluded.sms_consent_at, customers.sms_consent_at),
               updated_at = now()
         returning id`,
        [
          input.firstName,
          input.lastName,
          input.email,
          input.phone,
          input.smsConsent ? new Date() : null,
        ],
      );
      const customerId = customerRows[0].id;

      // Terms acceptance, version, timestamp, IP, and agent, as evidence.
      await client.query(
        `insert into service_agreements (customer_id, version, ip_address, user_agent)
         values ($1, $2, $3, $4)`,
        [customerId, TERMS_VERSION, ip, userAgent],
      );

      // Property
      const { rows: propertyRows } = await client.query<{ id: string }>(
        `insert into properties
           (customer_id, line1, line2, city, state, postal_code, unit_size, has_pets)
         values ($1, $2, $3, $4, $5, $6, $7, $8)
         returning id`,
        [
          customerId,
          input.line1,
          input.line2 || null,
          input.city,
          input.state,
          input.postalCode,
          input.unitSize,
          input.hasPets,
        ],
      );
      const propertyId = propertyRows[0].id;

      // Entry details go to the encrypted table, never into general notes.
      //
      // A front-desk booking has no code at all, so there may be nothing to
      // store. Skip the row entirely in that case rather than writing one full
      // of nulls, an empty secrets row would still show up in the access log
      // as something worth revealing.
      const entry = encryptSecret(input.entryDetail || null);
      const alarm = encryptSecret(input.alarmInstructions || null);

      if (entry || alarm) {
        await client.query(
          `insert into property_access_secrets
             (property_id, gate_code_enc, door_code_enc, key_location_enc,
              alarm_instructions_enc)
           values ($1, $2, $3, $4, $5)`,
          [
            propertyId,
            input.entryMethod === "gate_code" ? entry : null,
            input.entryMethod === "door_code" ? entry : null,
            input.entryMethod === "key_location" ? entry : null,
            alarm,
          ],
        );
      }

      // Charged once, on this booking. The subscription itself carries no pet
      // surcharge, so nothing recurring is ever derived from it.
      const petSurcharge = input.hasPets ? PET_SURCHARGE_CENTS : 0;

      if (input.plan === "membership") {
        // An earlier attempt that never got paid for is replaced, not kept.
        // Somebody who reached Stripe, closed the tab and came back to fill the
        // form in again should end up with one membership, and the abandoned
        // row should not sit there blocking them.
        await client.query(
          `update visits set status = 'canceled'
            where subscription_id in (
              select id from subscriptions
               where customer_id = $1 and status = 'pending_payment'
            )`,
          [customerId],
        );
        await client.query(
          `update subscriptions
              set status = 'canceled', ends_on = current_date, updated_at = now()
            where customer_id = $1 and status = 'pending_payment'`,
          [customerId],
        );

        // One live membership per customer. Deliberately does not count an
        // unpaid attempt, which has just been cleared above.
        const { rows: existing } = await client.query<{ id: string }>(
          `select id from subscriptions
            where customer_id = $1
              and status in ('active', 'paused', 'pending_cancellation')
            limit 1
            for update`,
          [customerId],
        );
        if (existing[0]) {
          return {
            formError:
              "You already have a membership with us. Sign in to your account to change or cancel it, and get in touch if something does not look right.",
          } as const;
        }

        const startedOn = today();
        const billingDay = Math.min(Number(startedOn.slice(8, 10)), 28);

        // Everything that differs between the two membership tiers is read
        // from one place: how many cleanings a period includes, what the
        // period costs, whether a free add-on comes with it, and whether the
        // first cleaning is upgraded to a deep clean.
        const tier = membershipTier(input.frequency);
        const monthlyCents = membershipPrice(input.frequency, input.unitSize).monthlyCents;

        const { rows: subRows } = await client.query<{ id: string }>(
          `insert into subscriptions
             (customer_id, property_id, unit_size, status, monthly_amount_cents,
              visits_per_period, pet_surcharge_cents, preferred_weekday,
              started_on, billing_day)
           values ($1, $2, $3, 'pending_payment', $4, $5, $6, $7, $8, $9)
           returning id`,
          [
            customerId,
            propertyId,
            input.unitSize,
            // Snapshotted, not looked up, this is what grandfathers the rate.
            monthlyCents,
            tier.visitsPerPeriod,
            // Zero: the pet surcharge is one-time and sits on the first
            // cleaning below, never on the recurring subscription.
            0,
            input.preferredWeekday ?? null,
            startedOn,
            billingDay,
          ],
        );
        const subscriptionId = subRows[0].id;

        const sub: SubscriptionRow = {
          id: subscriptionId,
          customer_id: customerId,
          property_id: propertyId,
          status: "pending_payment",
          monthly_amount_cents: monthlyCents,
          visits_per_period: tier.visitsPerPeriod,
          // Public bookings are always the monthly membership. Custom
          // cadences are entered in admin.
          interval_days: null,
          pet_surcharge_cents: 0,
          preferred_weekday: input.preferredWeekday ?? null,
          preferred_weekday_second: null,
          started_on: startedOn,
          billing_day: billingDay,
          pending_amount_cents: null,
          pending_amount_effective_on: null,
          ends_on: null,
        };
        await generateForSubscription(client, sub, startedOn);

        // A new member's first cleaning is booked as a deep clean so the
        // cleaner's assignment reflects the work involved. This is operational
        // only, a member buys "cleanings", and the deep/standard split is
        // never surfaced to them in pricing, the booking form, or the terms.
        // Do not add it to customer-facing copy.
        //
        // Promoting the earliest generated visit rather than inserting another
        // keeps the period ledger at two visits used, so the deep clean is one
        // of the two the first month already pays for rather than a third.
        // The one-time pet surcharge rides on it.
        //
        // Only on the tier that can afford it. A twice-a-month period buys two
        // cleanings, so the deep one is half of what that month collects. A
        // once-a-month period buys one, and a deep clean costs more than the
        // period brings in with nothing else that month to balance it.
        await client.query(
          `update visits
              set service_type = $4::service_type,
                  pet_surcharge_cents = $2,
                  customer_instructions = $3
            where id = (
              select id from visits
               where subscription_id = $1
                 and status in ('pending_payment', 'scheduled')
               order by scheduled_for
               limit 1
            )`,
          [
            subscriptionId,
            petSurcharge,
            input.instructions || null,
            onboardingServiceType(input.frequency),
          ],
        );

        await attachAddOns(client, subscriptionId, input, true);
        return subscriptionId;
      }


      // One-time booking.
      const visitDate = input.preferredDate || addDays(today(), 3);
      const { rows: visitRows } = await client.query<{ id: string }>(
        `insert into visits
           (customer_id, property_id, origin, service_type, status,
            scheduled_for, base_amount_cents, pet_surcharge_cents,
            customer_instructions)
         values ($4, $5, 'one_off', $6, 'pending_payment',
                 ${timestamptzFromLocal(1, 2, 3)}, $7, $8, $9)
         returning id`,
        [
          visitDate,
          DEFAULT_VISIT_TIME,
          TIMEZONE,
          customerId,
          propertyId,
          input.serviceType,
          SERVICE_PRICES[input.unitSize][input.serviceType!],
          petSurcharge,
          input.instructions || null,
        ],
      );

      await attachOneOffAddOns(client, visitRows[0].id, input);
      return visitRows[0].id;
    });

    // A refusal rather than a reference: the booking was rejected on a rule,
    // not a failure, so it carries its own message instead of the generic one.
    if (typeof bookingRef !== "string") {
      return { ok: false, fieldErrors: {}, formError: bookingRef.formError };
    }

    return {
      ok: true,
      bookingRef,
      kind: input.plan === "membership" ? "membership" : "one_time",
      totalCents: quote.totalCents,
    };
  } catch (err) {
    console.error("Booking failed", err);
    return {
      ok: false,
      fieldErrors: {},
      formError:
        "Something went wrong saving your booking. Nothing was charged, so please try again.",
    };
  }
}

type Client = Parameters<Parameters<typeof transaction>[0]>[0];

/** Attach the chosen add-ons to a membership's first generated visit. */
async function attachAddOns(
  client: Client,
  subscriptionId: string,
  input: BookingInput,
  isMember: boolean,
): Promise<void> {
  const { rows } = await client.query<{ id: string; period_id: string | null }>(
    `select id, period_id from visits
      where subscription_id = $1
        and status in ('pending_payment', 'scheduled')
      order by scheduled_for
      limit 1`,
    [subscriptionId],
  );
  const visit = rows[0];
  if (!visit) return;

  await insertAddOns(client, visit.id, input, isMember, visit.period_id);
}

async function attachOneOffAddOns(
  client: Client,
  visitId: string,
  input: BookingInput,
): Promise<void> {
  await insertAddOns(client, visitId, input, false, null);
}

async function insertAddOns(
  client: Client,
  visitId: string,
  input: BookingInput,
  isMember: boolean,
  periodId: string | null,
): Promise<void> {
  // What the deep clean covers is added here rather than trusted from the
  // form. The form ticks them and disables them, but this is a server action
  // and can be called directly, and a cleaner arriving without knowing to do
  // the fridge is a complaint whether or not the request was well formed.
  const codes = [
    ...new Set([
      ...input.addOns,
      ...(input.serviceType === "deep" ? DEEP_CLEAN_INCLUDES : []),
    ]),
  ];
  if (codes.length === 0) return;

  const { rows: catalog } = await client.query<{
    id: string;
    code: string;
    price_cents: number;
    free_perk_eligible: boolean;
  }>(`select id, code, price_cents, free_perk_eligible from add_ons where code = any($1)`, [
    codes,
  ]);

  let addOnsTotal = 0;

  // Membership alone does not buy the free add-on, the tier does. The schema
  // already refuses a perk on a tier without one, and this is the second lock
  // on the same door: it is the line that decides whether money is charged.
  const tierHasFreeAddOn = isMember && membershipTier(input.frequency).freeAddOn;

  for (const addOn of catalog) {
    // A deep clean already covers these, so they are stored against the visit
    // at nothing. Stored rather than dropped, because the cleaner's job sheet
    // is built from this table and somebody needs to know to open the fridge.
    //
    // Checked here as well as in the quote. This is the line that decides
    // what the card is charged, and the two must not be able to disagree.
    if (includedInService(addOn.code, input.serviceType)) {
      await client.query(
        `insert into visit_add_ons (visit_id, add_on_id, price_cents_at_time, is_free_perk)
         values ($1, $2, 0, false)
         on conflict (visit_id, add_on_id) do nothing`,
        [visitId, addOn.id],
      );
      continue;
    }

    const isFreePerk =
      tierHasFreeAddOn && Boolean(input.freePerk) && addOn.code === input.freePerk;

    // The free perk is claimed against the period ledger, under a row lock,
    // so a double submission cannot hand out two of them.
    if (isFreePerk && periodId) {
      const { claimFreePerk } = await import("@/lib/membership-lifecycle");
      const result = await claimFreePerk(client, periodId, visitId, addOn.id);
      if (result.claimed) continue;
    }

    const price = isMember ? Math.round(addOn.price_cents * 0.9) : addOn.price_cents;
    addOnsTotal += price;

    await client.query(
      `insert into visit_add_ons (visit_id, add_on_id, price_cents_at_time, is_free_perk)
       values ($1, $2, $3, false)
       on conflict (visit_id, add_on_id) do nothing`,
      [visitId, addOn.id, price],
    );
  }

  await client.query(`update visits set addons_amount_cents = $2 where id = $1`, [
    visitId,
    addOnsTotal,
  ]);
}
