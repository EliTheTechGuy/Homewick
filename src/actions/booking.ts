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
  MEMBERSHIP_PRICES,
  PET_SURCHARGE_CENTS,
  SERVICE_PRICES,
  VISITS_PER_PERIOD,
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
      "Booking rejected: missing configuration —",
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
        "Online booking is temporarily unavailable. Nothing has been charged — please try again shortly.",
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
      // Customer — a repeat booker keeps their existing record.
      const { rows: customerRows } = await client.query<{ id: string }>(
        `insert into customers (first_name, last_name, email, phone, sms_consent_at)
         values ($1, $2, $3, $4, $5)
         on conflict (email) do update
           set first_name = excluded.first_name,
               last_name  = excluded.last_name,
               phone      = excluded.phone,
               sms_consent_at = coalesce(excluded.sms_consent_at, customers.sms_consent_at),
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

      // Terms acceptance — version, timestamp, IP, and agent, as evidence.
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
      // of nulls — an empty secrets row would still show up in the access log
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
        const startedOn = today();
        const billingDay = Math.min(Number(startedOn.slice(8, 10)), 28);

        const { rows: subRows } = await client.query<{ id: string }>(
          `insert into subscriptions
             (customer_id, property_id, unit_size, status, monthly_amount_cents,
              visits_per_period, pet_surcharge_cents, preferred_weekday,
              started_on, billing_day)
           values ($1, $2, $3, 'active', $4, $5, $6, $7, $8, $9)
           returning id`,
          [
            customerId,
            propertyId,
            input.unitSize,
            // Snapshotted, not looked up — this is what grandfathers the rate.
            MEMBERSHIP_PRICES[input.unitSize].monthlyCents,
            VISITS_PER_PERIOD,
            // Zero: the pet surcharge is one-time and sits on the onboarding
            // deep clean below, never on the recurring subscription.
            0,
            input.preferredWeekday ?? null,
            startedOn,
            billingDay,
          ],
        );
        const subscriptionId = subRows[0].id;

        // The onboarding deep clean is a one-off, billed separately from the
        // first month rather than bundled into it. It is also the member's
        // first visit, so the regular cleanings are placed after it below.
        const earliestVisit = addDays(startedOn, MIN_LEAD_DAYS);
        const firstVisitDate =
          input.preferredWeekday === undefined
            ? earliestVisit
            : firstWeekdayOnOrAfter(earliestVisit, input.preferredWeekday);

        await client.query(
          `insert into visits
             (customer_id, property_id, origin, service_type, status,
              scheduled_for, base_amount_cents, pet_surcharge_cents,
              customer_instructions)
           values ($4, $5, 'one_off', 'deep', 'scheduled',
                   ${timestamptzFromLocal(1, 2, 3)}, $6, $7, $8)`,
          [
            firstVisitDate,
            DEFAULT_VISIT_TIME,
            TIMEZONE,
            customerId,
            propertyId,
            Math.round(SERVICE_PRICES[input.unitSize].deep * 0.85),
            petSurcharge,
            input.instructions || null,
          ],
        );

        const sub: SubscriptionRow = {
          id: subscriptionId,
          customer_id: customerId,
          property_id: propertyId,
          status: "active",
          monthly_amount_cents: MEMBERSHIP_PRICES[input.unitSize].monthlyCents,
          visits_per_period: VISITS_PER_PERIOD,
          pet_surcharge_cents: 0,
          preferred_weekday: input.preferredWeekday ?? null,
          started_on: startedOn,
          billing_day: billingDay,
          pending_amount_cents: null,
          pending_amount_effective_on: null,
          ends_on: null,
        };
        // Regular cleanings start the day after the onboarding deep clean, so
        // a new member is never sent a standard clean before the deep one.
        await generateForSubscription(
          client,
          sub,
          startedOn,
          addDays(firstVisitDate, 1),
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
         values ($4, $5, 'one_off', $6, 'scheduled',
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
        "Something went wrong saving your booking. Nothing was charged — please try again.",
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
      where subscription_id = $1 and status = 'scheduled'
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
  if (input.addOns.length === 0) return;

  const { rows: catalog } = await client.query<{
    id: string;
    code: string;
    price_cents: number;
    free_perk_eligible: boolean;
  }>(`select id, code, price_cents, free_perk_eligible from add_ons where code = any($1)`, [
    input.addOns,
  ]);

  let addOnsTotal = 0;

  for (const addOn of catalog) {
    const isFreePerk =
      isMember && Boolean(input.freePerk) && addOn.code === input.freePerk;

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
