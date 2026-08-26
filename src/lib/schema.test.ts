import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { decryptSecret, encryptSecret } from "./secrets";
import { beforeAll, afterAll, test } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { citext } from "@electric-sql/pglite/contrib/citext";
import { generateForSubscription, type SubscriptionRow } from "./membership-lifecycle";
import {
  ADD_ONS,
  MEMBERSHIP_TIERS,
  SERVICE_PRICES,
  frequencyForVisits,
  type ServiceType,
  type UnitSize,
} from "./pricing";

/**
 * Runs the migration sequence against a real Postgres (PGlite, in-process) and then
 * drives the visit generator against it. The generator's SQL is otherwise
 * never executed until it runs against production data, which is too late to
 * discover a typo in a column name.
 */

let db: PGlite;

/** Adapts PGlite to the small slice of pg's PoolClient the generator uses. */
type ClientLike = Parameters<typeof generateForSubscription>[0];
function asClient(pglite: PGlite): ClientLike {
  return {
    query: (text: string, params?: unknown[]) => pglite.query(text, params),
  } as unknown as ClientLike;
}

beforeAll(async () => {
  db = new PGlite({ extensions: { citext } });

  // Runs the real migration sequence, in the real order, so this test covers
  // whatever `npm run db:migrate` would do to a fresh database.
  const dir = fileURLToPath(new URL("../../db/migrations/", import.meta.url));
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  assert.ok(files.length > 0, "no migrations found");

  for (const file of files) {
    const sql = await readFile(dir + file, "utf8");
    // PGlite has no pgcrypto build. It is only wanted for gen_random_uuid(),
    // which has been core Postgres since 13, so dropping the extension line
    // changes nothing being tested here. Supabase and Neon both ship it.
    await db.exec(sql.replace(/create extension if not exists "pgcrypto";\n/, ""));
  }
}, 60_000);

afterAll(async () => {
  await db?.close();
});

/**
 * The catalog in code and the catalog in the database have to agree.
 *
 * Counting rows only proved something had been seeded. It said nothing about
 * the numbers, so a price changed in one place and not the other would have
 * gone through green. These read the currently effective row for every size
 * and compare it against what the site quotes.
 */
test("schema applies cleanly and seeds launch pricing", async () => {
  const services = await db.query<{
    unit_size: string;
    service_type: string;
    amount_cents: number;
  }>(
    `select unit_size::text as unit_size, service_type::text as service_type, amount_cents
       from service_prices
      where effective_from <= current_date
        and (effective_to is null or effective_to > current_date)`,
  );
  assert.equal(services.rows.length, 9, "one live price per size and service");
  for (const row of services.rows) {
    assert.equal(
      row.amount_cents,
      SERVICE_PRICES[row.unit_size as UnitSize][row.service_type as ServiceType],
      `${row.unit_size} ${row.service_type} is priced differently in the database`,
    );
  }

  const memberships = await db.query<{
    unit_size: string;
    visits_included: number;
    monthly_amount_cents: number;
  }>(
    `select unit_size::text as unit_size, visits_included, monthly_amount_cents
       from membership_prices
      where effective_from <= current_date
        and (effective_to is null or effective_to > current_date)`,
  );
  assert.equal(memberships.rows.length, 6, "three sizes on each of the two tiers");
  for (const row of memberships.rows) {
    const frequency = frequencyForVisits(row.visits_included);
    assert.ok(frequency, `${row.visits_included} visits matches no membership tier`);
    assert.equal(
      row.monthly_amount_cents,
      MEMBERSHIP_TIERS[frequency].prices[row.unit_size as UnitSize].monthlyCents,
      `${frequency} ${row.unit_size} is priced differently in the database`,
    );
  }

  // The one that bites hardest. The booking form quotes from ADD_ONS in code
  // and insertAddOns bills from this table, so a price changed in one place
  // and not the other shows a customer one number and charges them another,
  // with nothing erroring and no test failing anywhere else.
  const addOns = await db.query<{
    code: string;
    price_cents: number;
    free_perk_eligible: boolean;
  }>("select code, price_cents, free_perk_eligible from add_ons order by sort_order");
  assert.equal(addOns.rows.length, ADD_ONS.length, "every add-on in code exists in the database");
  for (const row of addOns.rows) {
    const inCode = ADD_ONS.find((a) => a.code === row.code);
    assert.ok(inCode, `${row.code} is in the database but not in the catalog`);
    assert.equal(
      row.price_cents,
      inCode.priceCents,
      `${row.code} is quoted at ${inCode.priceCents} and billed at ${row.price_cents}`,
    );
    assert.equal(
      row.free_perk_eligible,
      inCode.freePerkEligible,
      `${row.code} disagrees about whether it can be claimed free`,
    );
  }

  assert.deepEqual(
    addOns.rows.filter((r) => r.free_perk_eligible).map((r) => r.code),
    ["oven", "fridge", "windows", "balcony"],
  );
});

test("every table holding customer data has row-level security enabled", async () => {
  // On Supabase these tables are served over HTTP by PostgREST. Without RLS,
  // the anon key, which ships in browser bundles, would read the customer
  // list, home addresses, and the access-secret rows.
  const { rows } = await db.query<{ tablename: string; rowsecurity: boolean }>(
    `select tablename, rowsecurity from pg_tables
      where schemaname = 'public' order by tablename`,
  );

  const unprotected = rows.filter((t) => !t.rowsecurity).map((t) => t.tablename);
  assert.deepEqual(unprotected, [], `tables missing RLS: ${unprotected.join(", ")}`);
});

test("only the price book is publicly readable", async () => {
  const { rows } = await db.query<{ tablename: string }>(
    `select distinct tablename from pg_policies
      where schemaname = 'public' order by tablename`,
  );

  assert.deepEqual(
    rows.map((r) => r.tablename),
    ["add_ons", "membership_prices", "service_prices"],
    "a table other than the price book has been made publicly readable",
  );
});

test("laundry and cabinets are not eligible as the free perk", async () => {
  const { rows } = await db.query<{ code: string }>(
    "select code from add_ons where not free_perk_eligible order by sort_order",
  );
  assert.deepEqual(
    rows.map((r) => r.code),
    ["cabinets", "laundry"],
  );
});

test("billing_day is constrained to 1-28", async () => {
  const { customerId, propertyId } = await seedCustomer("billing@example.com");

  await assert.rejects(
    db.query(
      `insert into subscriptions
         (customer_id, property_id, unit_size, monthly_amount_cents,
          started_on, billing_day)
       values ($1, $2, '2br_2ba', 26900, '2026-01-31', 31)`,
      [customerId, propertyId],
    ),
    /billing_day/,
  );
});

test("a membership visit must belong to a period, a one-off must not", async () => {
  const { customerId, propertyId } = await seedCustomer("origin@example.com");

  await assert.rejects(
    db.query(
      `insert into visits
         (customer_id, property_id, origin, service_type, scheduled_for)
       values ($1, $2, 'membership', 'standard', now())`,
      [customerId, propertyId],
    ),
    /visits_check|constraint/i,
  );

  // A one-off with no period is fine.
  await db.query(
    `insert into visits
       (customer_id, property_id, origin, service_type, scheduled_for)
     values ($1, $2, 'one_off', 'standard', now())`,
    [customerId, propertyId],
  );
});

test("only one free perk may be claimed per visit", async () => {
  const { customerId, propertyId } = await seedCustomer("perk@example.com");
  const visit = await db.query<{ id: string }>(
    `insert into visits (customer_id, property_id, origin, service_type, scheduled_for)
     values ($1, $2, 'one_off', 'standard', now()) returning id`,
    [customerId, propertyId],
  );
  const visitId = visit.rows[0].id;

  const addOns = await db.query<{ id: string }>(
    "select id from add_ons where free_perk_eligible order by sort_order limit 2",
  );

  await db.query(
    `insert into visit_add_ons (visit_id, add_on_id, price_cents_at_time, is_free_perk)
     values ($1, $2, 0, true)`,
    [visitId, addOns.rows[0].id],
  );

  await assert.rejects(
    db.query(
      `insert into visit_add_ons (visit_id, add_on_id, price_cents_at_time, is_free_perk)
       values ($1, $2, 0, true)`,
      [visitId, addOns.rows[1].id],
    ),
    /one_free_perk_per_visit/,
  );
});

test("visits_used may not exceed the allotment", async () => {
  const { customerId, propertyId } = await seedCustomer("ledger@example.com");
  const sub = await insertSubscription(customerId, propertyId, "2026-01-15", 15);

  await assert.rejects(
    db.query(
      `insert into subscription_periods
         (subscription_id, period_start, period_end, visits_allotted,
          visits_used, amount_cents)
       values ($1, '2026-01-15', '2026-02-15', 2, 3, 26900)`,
      [sub],
    ),
    /visits_used|constraint/i,
  );
});

test("the generator creates periods and visits, and is idempotent", async () => {
  const { customerId, propertyId } = await seedCustomer("generate@example.com");
  const subscriptionId = await insertSubscription(
    customerId,
    propertyId,
    "2026-01-15",
    15,
  );

  const sub: SubscriptionRow = {
    id: subscriptionId,
    customer_id: customerId,
    property_id: propertyId,
    status: "active",
    monthly_amount_cents: 26900,
    visits_per_period: 2,
    pet_surcharge_cents: 1500,
    interval_days: null,
    payment_terms: "on_booking",
    visit_time: "09:00",
    preferred_weekday: 4,
    preferred_weekday_second: null,
    started_on: "2026-01-15",
    billing_day: 15,
    pending_amount_cents: null,
    pending_amount_effective_on: null,
    ends_on: null,
  };

  const first = await generateForSubscription(asClient(db), sub, "2026-01-15");
  assert.ok(first.periodsCreated >= 2, "should create current and next period");
  assert.equal(first.visitsCreated, first.periodsCreated * 2);

  // Running the same day again must not double-book anyone.
  const second = await generateForSubscription(asClient(db), sub, "2026-01-15");
  assert.equal(second.periodsCreated, 0);
  assert.equal(second.visitsCreated, 0);

  const visits = await db.query<{ count: number }>(
    "select count(*)::int as count from visits where subscription_id = $1",
    [subscriptionId],
  );
  assert.equal(visits.rows[0].count, first.visitsCreated);

  // The ledger reflects what is actually on the calendar.
  const ledger = await db.query<{ visits_used: number; visits_allotted: number }>(
    `select visits_used, visits_allotted from subscription_periods
      where subscription_id = $1 order by period_start`,
    [subscriptionId],
  );
  for (const period of ledger.rows) {
    assert.equal(period.visits_used, 2);
    assert.equal(period.visits_allotted, 2);
  }
});

test("generated visits carry no pet surcharge and stay inside their period", async () => {
  const { customerId, propertyId } = await seedCustomer("pets@example.com");
  const subscriptionId = await insertSubscription(
    customerId,
    propertyId,
    "2026-03-10",
    10,
  );

  await generateForSubscription(
    asClient(db),
    {
      id: subscriptionId,
      customer_id: customerId,
      property_id: propertyId,
      status: "active",
      monthly_amount_cents: 26900,
      visits_per_period: 2,
      pet_surcharge_cents: 1500,
      preferred_weekday: 2,
      preferred_weekday_second: null,
      started_on: "2026-03-10",
      billing_day: 10,
      interval_days: null,
    payment_terms: "on_booking",
    visit_time: "09:00",
      pending_amount_cents: null,
      pending_amount_effective_on: null,
      ends_on: null,
    },
    "2026-03-10",
  );

  const { rows } = await db.query<{
    pet_surcharge_cents: number;
    scheduled_date: string;
    period_start: string;
    period_end: string;
  }>(
    `select v.pet_surcharge_cents,
            (v.scheduled_for at time zone 'America/Chicago')::date::text as scheduled_date,
            sp.period_start::text, sp.period_end::text
       from visits v
       join subscription_periods sp on sp.id = v.period_id
      where v.subscription_id = $1
      order by v.scheduled_for`,
    [subscriptionId],
  );

  assert.ok(rows.length > 0);
  for (const row of rows) {
    // The pet surcharge is one-time, taken on the booking that introduces the
    // pet home. Repeating it here would bill a member every fortnight.
    assert.equal(row.pet_surcharge_cents, 0);
    assert.ok(
      row.scheduled_date >= row.period_start && row.scheduled_date < row.period_end,
      `visit ${row.scheduled_date} escaped period ${row.period_start} to ${row.period_end}`,
    );
  }
});

test("an entry code round-trips through the encrypted bytea column", async () => {
  const { propertyId } = await seedCustomer("secrets@example.com");

  process.env.ACCESS_SECRET_KEY = randomBytes(32).toString("base64");
  const plaintext = "gate 4821, then unit 410";

  await db.query(
    `insert into property_access_secrets (property_id, door_code_enc) values ($1, $2)`,
    [propertyId, encryptSecret(plaintext)],
  );

  const { rows } = await db.query<{ door_code_enc: Uint8Array }>(
    "select door_code_enc from property_access_secrets where property_id = $1",
    [propertyId],
  );

  // What lands in the column must not be readable without the key.
  const stored = Buffer.from(rows[0].door_code_enc);
  assert.ok(!stored.toString("utf8").includes("4821"), "entry code stored in the clear");

  assert.equal(decryptSecret(stored), plaintext);
});

test("a tampered ciphertext is rejected rather than silently decrypted", async () => {
  process.env.ACCESS_SECRET_KEY = randomBytes(32).toString("base64");
  const sealed = encryptSecret("door 1234")!;
  sealed[sealed.length - 1] ^= 0xff;

  assert.throws(() => decryptSecret(sealed));
});

test("a date-only visit does not slip to the previous day in local time", async () => {
  const { customerId, propertyId } = await seedCustomer("tz@example.com");

  // Insert the way the app does: a local date plus a local time, converted
  // once by Postgres in America/Chicago.
  await db.query(
    `insert into visits
       (customer_id, property_id, origin, service_type, scheduled_for)
     values ($1, $2, 'one_off', 'standard',
             (('2026-11-01'::date + '09:00'::time) at time zone 'America/Chicago'))`,
    [customerId, propertyId],
  );

  const { rows } = await db.query<{ local_date: string }>(
    `select (scheduled_for at time zone 'America/Chicago')::date::text as local_date
       from visits where customer_id = $1`,
    [customerId],
  );
  assert.equal(rows[0].local_date, "2026-11-01");
});

async function seedCustomer(email: string) {
  const customer = await db.query<{ id: string }>(
    `insert into customers (first_name, last_name, email, phone)
     values ('Test', 'Customer', $1, '555-0100') returning id`,
    [email],
  );
  const customerId = customer.rows[0].id;

  const property = await db.query<{ id: string }>(
    `insert into properties (customer_id, line1, city, postal_code, unit_size, has_pets)
     values ($1, '1 Main St', 'Dallas', '75201', '2br_2ba', true) returning id`,
    [customerId],
  );

  return { customerId, propertyId: property.rows[0].id };
}

async function insertSubscription(
  customerId: string,
  propertyId: string,
  startedOn: string,
  billingDay: number,
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into subscriptions
       (customer_id, property_id, unit_size, monthly_amount_cents,
        pet_surcharge_cents, preferred_weekday, started_on, billing_day)
     values ($1, $2, '2br_2ba', 26900, 1500, 4, $3, $4)
     returning id`,
    [customerId, propertyId, startedOn, billingDay],
  );
  return rows[0].id;
}

test("an unpaid membership puts nothing on the schedule", async () => {
  // The bug this guards: a booking used to be written as active before Stripe
  // was ever contacted, so abandoning the payment page bought a free
  // membership that generated visits and dispatched cleaners for ever.
  const { customerId, propertyId } = await seedCustomer("unpaid@example.com");
  const subscriptionId = await insertSubscription(
    customerId,
    propertyId,
    "2026-01-15",
    15,
  );
  await db.query(`update subscriptions set status = 'pending_payment' where id = $1`, [
    subscriptionId,
  ]);

  const sub: SubscriptionRow = {
    id: subscriptionId,
    customer_id: customerId,
    property_id: propertyId,
    status: "pending_payment",
    monthly_amount_cents: 26900,
    visits_per_period: 2,
    pet_surcharge_cents: 0,
    interval_days: null,
    payment_terms: "on_booking",
    visit_time: "09:00",
    preferred_weekday: 4,
    preferred_weekday_second: null,
    started_on: "2026-01-15",
    billing_day: 15,
    pending_amount_cents: null,
    pending_amount_effective_on: null,
    ends_on: null,
  };

  await generateForSubscription(asClient(db), sub, "2026-01-15");

  const held = await db.query<{ status: string; n: number }>(
    `select status::text as status, count(*)::int as n
       from visits where subscription_id = $1 group by 1`,
    [subscriptionId],
  );

  assert.deepEqual(
    held.rows.map((r) => r.status),
    ["pending_payment"],
    "every generated visit must be held until the membership is paid for",
  );

  // The two queries that put a cleaner on a doorstep.
  const onSchedule = await db.query<{ n: number }>(
    `select count(*)::int as n from visits
      where subscription_id = $1 and status not in ('canceled', 'pending_payment')`,
    [subscriptionId],
  );
  assert.equal(onSchedule.rows[0].n, 0, "unpaid work must not reach the schedule");

  const remindable = await db.query<{ n: number }>(
    `select count(*)::int as n from visits
      where subscription_id = $1 and status in ('scheduled', 'assigned')`,
    [subscriptionId],
  );
  assert.equal(remindable.rows[0].n, 0, "unpaid work must not earn a reminder email");

  // And the daily generator must not pick the subscription up at all.
  const generated = await db.query<{ n: number }>(
    `select count(*)::int as n from subscriptions
      where id = $1 and status in ('active', 'pending_cancellation')`,
    [subscriptionId],
  );
  assert.equal(generated.rows[0].n, 0, "an unpaid membership must not be topped up daily");
});

test("paying promotes the membership and releases its visits", async () => {
  const { customerId, propertyId } = await seedCustomer("promoted@example.com");
  const subscriptionId = await insertSubscription(
    customerId,
    propertyId,
    "2026-01-15",
    15,
  );
  await db.query(`update subscriptions set status = 'pending_payment' where id = $1`, [
    subscriptionId,
  ]);

  const sub: SubscriptionRow = {
    id: subscriptionId,
    customer_id: customerId,
    property_id: propertyId,
    status: "pending_payment",
    monthly_amount_cents: 26900,
    visits_per_period: 2,
    pet_surcharge_cents: 0,
    interval_days: null,
    payment_terms: "on_booking",
    visit_time: "09:00",
    preferred_weekday: 4,
    preferred_weekday_second: null,
    started_on: "2026-01-15",
    billing_day: 15,
    pending_amount_cents: null,
    pending_amount_effective_on: null,
    ends_on: null,
  };
  await generateForSubscription(asClient(db), sub, "2026-01-15");

  // Exactly what the webhook runs on checkout.session.completed.
  await db.query(
    `update subscriptions
        set status = case when status = 'pending_payment' then 'active' else status end
      where id = $1`,
    [subscriptionId],
  );
  await db.query(
    `update visits set status = 'scheduled'
      where subscription_id = $1 and status = 'pending_payment'`,
    [subscriptionId],
  );

  const live = await db.query<{ n: number }>(
    `select count(*)::int as n from visits
      where subscription_id = $1 and status = 'scheduled'`,
    [subscriptionId],
  );
  assert.ok(live.rows[0].n > 0, "paying must release the visits onto the schedule");

  // A late or duplicate webhook must not resurrect a membership that has since
  // been cancelled.
  await db.query(`update subscriptions set status = 'canceled' where id = $1`, [
    subscriptionId,
  ]);
  await db.query(
    `update subscriptions
        set status = case when status = 'pending_payment' then 'active' else status end
      where id = $1`,
    [subscriptionId],
  );
  const after = await db.query<{ status: string }>(
    `select status::text as status from subscriptions where id = $1`,
    [subscriptionId],
  );
  assert.equal(after.rows[0].status, "canceled", "promotion must only move forward");
});

test("a rate change settles, so a second change cannot revert to the signup price", async () => {
  // The bug: nothing ever promoted pending_amount_cents into
  // monthly_amount_cents, so a member who changed size twice had the second
  // change fall back to whatever they paid on day one.
  const { customerId, propertyId } = await seedCustomer("rates@example.com");
  const subscriptionId = await insertSubscription(customerId, propertyId, "2026-01-15", 15);

  // Signed up at the studio rate, then upsized to 2 bed from 15 February.
  await db.query(
    `update subscriptions
        set monthly_amount_cents = 18900,
            pending_amount_cents = 26900,
            pending_amount_effective_on = '2026-02-15'
      where id = $1`,
    [subscriptionId],
  );

  // What the daily job now does before reading any rate.
  const settle = async (on: string) =>
    db.query(
      `update subscriptions
          set monthly_amount_cents = pending_amount_cents,
              pending_amount_cents = null,
              pending_amount_effective_on = null
        where pending_amount_cents is not null
          and pending_amount_effective_on is not null
          and pending_amount_effective_on <= $1::date`,
      [on],
    );

  // Before the date arrives, nothing moves.
  await settle("2026-02-01");
  let row = await db.query<{ monthly: number; pending: number | null }>(
    `select monthly_amount_cents as monthly, pending_amount_cents as pending
       from subscriptions where id = $1`,
    [subscriptionId],
  );
  assert.equal(row.rows[0].monthly, 18900, "the change must not land early");
  assert.equal(row.rows[0].pending, 26900);

  // On the date, it settles.
  await settle("2026-02-15");
  row = await db.query(
    `select monthly_amount_cents as monthly, pending_amount_cents as pending
       from subscriptions where id = $1`,
    [subscriptionId],
  );
  assert.equal(row.rows[0].monthly, 26900, "the new rate must become the real one");
  assert.equal(row.rows[0].pending, null, "and stop being pending");

  // Now a second change. Before the fix, this is where it reverted: the
  // fallback still read 18900, the price they left two months earlier.
  await db.query(
    `update subscriptions
        set pending_amount_cents = 36900, pending_amount_effective_on = '2026-03-15'
      where id = $1`,
    [subscriptionId],
  );
  row = await db.query(
    `select monthly_amount_cents as monthly, pending_amount_cents as pending
       from subscriptions where id = $1`,
    [subscriptionId],
  );
  assert.equal(
    row.rows[0].monthly,
    26900,
    "the rate in force must be the one they are actually paying, not the signup price",
  );
});

test("an uninvoiced period takes the new rate; an invoiced one never does", async () => {
  // Periods are created up to ~2.5 months ahead, so by the time somebody
  // changes size the affected rows already exist. Written once and left
  // alone, they kept the old figure and the ledger silently disagreed with
  // Stripe by the difference between two plans.
  const { customerId, propertyId } = await seedCustomer("periods@example.com");
  const subscriptionId = await insertSubscription(customerId, propertyId, "2026-01-15", 15);

  await db.query(
    `insert into subscription_periods
       (subscription_id, period_start, period_end, visits_allotted, amount_cents, stripe_invoice_id)
     values ($1, '2026-02-15', '2026-03-15', 2, 26900, 'in_already_billed'),
            ($1, '2026-03-15', '2026-04-15', 2, 26900, null)`,
    [subscriptionId],
  );

  const upsert = async (start: string, end: string, cents: number) =>
    db.query<{ id: string; created: boolean }>(
      `insert into subscription_periods
         (subscription_id, period_start, period_end, visits_allotted, amount_cents)
       values ($1, $2, $3, 2, $4)
       on conflict (subscription_id, period_start) do update
         set amount_cents = excluded.amount_cents
         where subscription_periods.stripe_invoice_id is null
           and subscription_periods.amount_cents <> excluded.amount_cents
       returning id, (xmax = 0) as created`,
      [subscriptionId, start, end, cents],
    );

  const invoiced = await upsert("2026-02-15", "2026-03-15", 36900);
  const open = await upsert("2026-03-15", "2026-04-15", 36900);

  assert.equal(invoiced.rows.length, 0, "an invoiced period must not be repriced");
  assert.equal(open.rows.length, 1, "an uninvoiced period must be corrected");
  assert.equal(open.rows[0].created, false, "correcting one is not creating one");

  const after = await db.query<{ period_start: string; amount_cents: number }>(
    `select period_start::text, amount_cents from subscription_periods
      where subscription_id = $1 order by period_start`,
    [subscriptionId],
  );
  assert.equal(after.rows[0].amount_cents, 26900, "money already taken stays as recorded");
  assert.equal(after.rows[1].amount_cents, 36900, "money not yet taken follows the new rate");
});

test("the slot survives a member reordering their two cleanings", async () => {
  // The bug: which cleaning was "first" was worked out by counting how many
  // fell earlier, which is only right while they stay in order. Move the
  // second before the first and they swap, so the next move writes the
  // remembered weekday to the wrong one.
  const { customerId, propertyId } = await seedCustomer("slots@example.com");
  const subscriptionId = await insertSubscription(customerId, propertyId, "2026-01-15", 15);
  const period = (
    await db.query<{ id: string }>(
      `insert into subscription_periods
         (subscription_id, period_start, period_end, visits_allotted, amount_cents)
       values ($1, '2026-02-15', '2026-03-15', 2, 26900) returning id`,
      [subscriptionId],
    )
  ).rows[0].id;

  const makeVisit = async (on: string, slot: number) =>
    (
      await db.query<{ id: string }>(
        `insert into visits
           (customer_id, property_id, subscription_id, period_id, origin,
            service_type, status, scheduled_for, slot)
         values ($1, $2, $3, $4, 'membership', 'standard', 'scheduled',
                 ($5::date + time '09:00') at time zone 'America/Chicago', $6)
         returning id`,
        [customerId, propertyId, subscriptionId, period, on, slot],
      )
    ).rows[0].id;

  const first = await makeVisit("2026-02-17", 0);
  const second = await makeVisit("2026-03-03", 1);

  // The member moves the second one to before the first.
  await db.query(
    `update visits set scheduled_for = ('2026-02-16'::date + time '09:00')
       at time zone 'America/Chicago' where id = $1`,
    [second],
  );

  // Counting, which is what the old code did.
  const counted = await db.query<{ n: number }>(
    `select count(*)::int as n from visits other
      where other.period_id = $1 and other.status <> 'canceled'
        and other.scheduled_for < (select scheduled_for from visits where id = $2)`,
    [period, second],
  );
  assert.equal(counted.rows[0].n, 0, "counting now calls the second cleaning the first");

  // Reading the stored slot, which is what it does now.
  const stored = await db.query<{ slot: number }>(
    `select slot from visits where id = $1`,
    [second],
  );
  assert.equal(stored.rows[0].slot, 1, "the stored slot is unchanged by a move");

  const firstStored = await db.query<{ slot: number }>(
    `select slot from visits where id = $1`,
    [first],
  );
  assert.equal(firstStored.rows[0].slot, 0, "and neither is the other one");
});

test("realignment finds the right visit even when one is assigned", async () => {
  // The bug: the lookup counted only 'scheduled' visits, so an assigned one
  // shifted every later offset. A September period whose first clean was
  // already assigned would have its second moved into the first week,
  // collapsing both into one fortnight.
  const { customerId, propertyId } = await seedCustomer("realign@example.com");
  const subscriptionId = await insertSubscription(customerId, propertyId, "2026-01-15", 15);
  const period = (
    await db.query<{ id: string }>(
      `insert into subscription_periods
         (subscription_id, period_start, period_end, visits_allotted, amount_cents)
       values ($1, '2026-02-15', '2026-03-15', 2, 26900) returning id`,
      [subscriptionId],
    )
  ).rows[0].id;

  const add = async (on: string, slot: number, status: string) =>
    (
      await db.query<{ id: string }>(
        `insert into visits
           (customer_id, property_id, subscription_id, period_id, origin,
            service_type, status, scheduled_for, slot)
         values ($1, $2, $3, $4, 'membership', 'standard', $7::visit_state,
                 ($5::date + time '09:00') at time zone 'America/Chicago', $6)
         returning id`,
        [customerId, propertyId, subscriptionId, period, on, slot, status],
      )
    ).rows[0].id;

  const assigned = await add("2026-02-17", 0, "assigned");
  const open = await add("2026-03-03", 1, "scheduled");

  // What the old code did: skip assigned, then take by position.
  const byPosition = await db.query<{ id: string }>(
    `select id from visits where period_id = $1 and status = 'scheduled'
      order by scheduled_for offset 0 limit 1`,
    [period],
  );
  assert.equal(
    byPosition.rows[0].id,
    open,
    "counting positions returns the second cleaning when asked for the first",
  );

  // What it does now: look it up by slot.
  const bySlot = await db.query<{ id: string; status: string }>(
    `select id, status::text as status from visits
      where period_id = $1 and slot = 0 and status <> 'canceled' limit 1`,
    [period],
  );
  assert.equal(bySlot.rows[0].id, assigned, "the slot lookup returns the right visit");
  assert.equal(
    bySlot.rows[0].status,
    "assigned",
    "and it can then be recognised as committed work and left alone",
  );
});

test("an email is claimed once, and a failed send releases the claim", async () => {
  // sendOnce is the only thing stopping a Stripe webhook retry sending a
  // second "welcome to your membership", which reads to a customer like a
  // second charge. It had no test at all.
  const { customerId } = await seedCustomer("once@example.com");
  const key = "evt_test_welcome";

  const claim = async () =>
    db.query<{ id: string }>(
      `insert into email_deliveries (event_key, kind, customer_id, recipient)
       values ($1, 'membership_welcome', $2, 'once@example.com')
       on conflict (event_key, kind) do nothing
       returning id`,
      [key, customerId],
    );

  const first = await claim();
  assert.equal(first.rows.length, 1, "the first delivery of an event claims the send");

  const second = await claim();
  assert.equal(second.rows.length, 0, "a retry of the same event must not claim it again");

  // A different kind for the same event is a different message and must be
  // free to send: the owner alert rides on the same Stripe event as the
  // customer's welcome.
  const otherKind = await db.query<{ id: string }>(
    `insert into email_deliveries (event_key, kind, customer_id, recipient)
     values ($1, 'owner_booking_alert', $2, 'owner@example.com')
     on conflict (event_key, kind) do nothing
     returning id`,
    [key, customerId],
  );
  assert.equal(otherKind.rows.length, 1, "a different message on the same event still sends");

  // Releasing on a failed send is what stops one bad minute at the mail
  // provider turning into a reminder that is never sent at all.
  await db.query(`delete from email_deliveries where id = $1`, [first.rows[0].id]);
  const afterRelease = await claim();
  assert.equal(afterRelease.rows.length, 1, "a released claim can be retried");
});

test("an expired checkout voids the booking it was for", async () => {
  // Stripe expires an abandoned session after 24 hours. Without handling it
  // the unpaid row sits for ever, blocking that customer from booking again.
  const { customerId, propertyId } = await seedCustomer("expired@example.com");
  const subscriptionId = await insertSubscription(customerId, propertyId, "2026-01-15", 15);
  await db.query(`update subscriptions set status = 'pending_payment' where id = $1`, [
    subscriptionId,
  ]);

  const period = (
    await db.query<{ id: string }>(
      `insert into subscription_periods
         (subscription_id, period_start, period_end, visits_allotted, amount_cents)
       values ($1, '2026-01-15', '2026-02-15', 2, 26900) returning id`,
      [subscriptionId],
    )
  ).rows[0].id;
  await db.query(
    `insert into visits
       (customer_id, property_id, subscription_id, period_id, origin, service_type,
        status, scheduled_for, slot)
     values ($1, $2, $3, $4, 'membership', 'standard', 'pending_payment',
             now() + interval '3 days', 0)`,
    [customerId, propertyId, subscriptionId, period],
  );

  // Exactly what the webhook runs on checkout.session.expired.
  await db.query(
    `update visits set status = 'canceled'
      where subscription_id = $1 and status = 'pending_payment'`,
    [subscriptionId],
  );
  await db.query(
    `update subscriptions
        set status = 'canceled', ends_on = current_date
      where id = $1 and status = 'pending_payment'`,
    [subscriptionId],
  );

  const sub = await db.query<{ status: string }>(
    `select status::text as status from subscriptions where id = $1`,
    [subscriptionId],
  );
  assert.equal(sub.rows[0].status, "canceled", "an abandoned booking is voided");

  const blocking = await db.query<{ n: number }>(
    `select count(*)::int as n from subscriptions
      where customer_id = $1 and status in ('active','paused','pending_cancellation')`,
    [customerId],
  );
  assert.equal(blocking.rows[0].n, 0, "and stops blocking that customer from booking again");

  const open = await db.query<{ n: number }>(
    `select count(*)::int as n from visits
      where subscription_id = $1 and status <> 'canceled'`,
    [subscriptionId],
  );
  assert.equal(open.rows[0].n, 0, "its visits go with it");
});

test("a late webhook cannot resurrect a cancelled membership", async () => {
  // Stripe retries, and a delayed checkout.session.completed arriving after
  // somebody cancelled must not put them back on the books.
  const { customerId, propertyId } = await seedCustomer("late@example.com");
  const subscriptionId = await insertSubscription(customerId, propertyId, "2026-01-15", 15);

  for (const state of ["canceled", "pending_cancellation"] as const) {
    await db.query(`update subscriptions set status = $2::subscription_state where id = $1`, [
      subscriptionId,
      state,
    ]);

    // What the webhook runs: promote only from pending_payment.
    await db.query(
      `update subscriptions
          set status = case when status = 'pending_payment' then 'active' else status end
        where id = $1`,
      [subscriptionId],
    );

    const after = await db.query<{ status: string }>(
      `select status::text as status from subscriptions where id = $1`,
      [subscriptionId],
    );
    assert.equal(after.rows[0].status, state, `${state} must survive a late webhook`);
  }
});

test("a once-a-month membership generates one cleaning per period, not two", async () => {
  const { customerId, propertyId } = await seedCustomer("oncemonthly@example.com");
  const subscriptionId = await insertSubscription(
    customerId,
    propertyId,
    "2026-01-15",
    15,
  );
  await db.query(
    "update subscriptions set visits_per_period = 1, monthly_amount_cents = 15200 where id = $1",
    [subscriptionId],
  );

  const sub: SubscriptionRow = {
    id: subscriptionId,
    customer_id: customerId,
    property_id: propertyId,
    status: "active",
    monthly_amount_cents: 15200,
    visits_per_period: 1,
    pet_surcharge_cents: 0,
    interval_days: null,
    payment_terms: "on_booking",
    visit_time: "09:00",
    preferred_weekday: 4,
    preferred_weekday_second: null,
    started_on: "2026-01-15",
    billing_day: 15,
    pending_amount_cents: null,
    pending_amount_effective_on: null,
    ends_on: null,
  };

  const run = await generateForSubscription(asClient(db), sub, "2026-01-15");
  assert.ok(run.periodsCreated >= 2, "should create current and next period");
  assert.equal(
    run.visitsCreated,
    run.periodsCreated,
    "one cleaning per period, so a member paying for one is not sent two cleaners",
  );

  const allotted = await db.query<{ visits_allotted: number }>(
    "select visits_allotted from subscription_periods where subscription_id = $1",
    [subscriptionId],
  );
  for (const row of allotted.rows) {
    assert.equal(row.visits_allotted, 1, "the ledger must allot what was paid for");
  }

  // The statement booking.ts runs to set what the first cleaning is. Kept here
  // because it casts a text parameter to the service_type enum, and a bad cast
  // is invisible to the typechecker and to every other test: it would only
  // surface as a failed signup in production.
  const promoted = await db.query(
    `update visits
        set service_type = $2::service_type
      where id = (
        select id from visits
         where subscription_id = $1
           and status in ('pending_payment', 'scheduled')
         order by scheduled_for
         limit 1
      )`,
    [subscriptionId, "standard"],
  );
  assert.equal(promoted.affectedRows, 1);

  const services = await db.query<{ service_type: string }>(
    `select service_type::text as service_type from visits
      where subscription_id = $1 order by scheduled_for`,
    [subscriptionId],
  );
  assert.ok(
    services.rows.every((r) => r.service_type === "standard"),
    "a once-a-month signup must not quietly hand out a deep clean",
  );
});

// --- Telling somebody their membership is over -------------------------

test("the end-of-membership notice reaches the members it should, and nobody else", async () => {
  const { ENDED_MEMBERSHIPS_SQL, CATCH_UP_DAYS } = await import("./emails/scheduled");
  const today = "2026-06-01";

  // Ended yesterday, paid for, still awaiting Stripe's confirmation. This is
  // the one that should be told.
  const ending = await seedCustomer("ended@example.com");
  const endedId = await insertSubscription(
    ending.customerId,
    ending.propertyId,
    "2026-01-15",
    15,
  );
  await db.query(
    `update subscriptions
        set status = 'pending_cancellation', ends_on = $2::date,
            stripe_subscription_id = 'sub_paid'
      where id = $1`,
    [endedId, today],
  );

  // Never paid. An abandoned signup is closed with an ends_on of today, and
  // telling somebody their membership has ended when they never had one is a
  // strange message to receive.
  const abandoned = await seedCustomer("abandoned@example.com");
  const abandonedId = await insertSubscription(
    abandoned.customerId,
    abandoned.propertyId,
    "2026-01-15",
    15,
  );
  await db.query(
    `update subscriptions set status = 'canceled', ends_on = $2::date where id = $1`,
    [abandonedId, today],
  );

  // Paid, ended, but has asked not to be marketed at. This message asks for
  // their business back, so the opt-out applies.
  const optedOut = await seedCustomer("optedout@example.com");
  const optedOutId = await insertSubscription(
    optedOut.customerId,
    optedOut.propertyId,
    "2026-01-15",
    15,
  );
  await db.query(
    `update subscriptions
        set status = 'canceled', ends_on = $2::date, stripe_subscription_id = 'sub_out'
      where id = $1`,
    [optedOutId, today],
  );
  await db.query(`update customers set nudge_opt_out_at = now() where id = $1`, [
    optedOut.customerId,
  ]);

  // Still running. Their end date is a fortnight away and they are mid-notice.
  const future = await seedCustomer("future@example.com");
  const futureId = await insertSubscription(
    future.customerId,
    future.propertyId,
    "2026-01-15",
    15,
  );
  await db.query(
    `update subscriptions
        set status = 'pending_cancellation', ends_on = '2026-06-15',
            stripe_subscription_id = 'sub_future'
      where id = $1`,
    [futureId],
  );

  // Ended long ago, before the catch-up window. A run that has been broken for
  // a month must not send a pile of these the day it is fixed.
  const old = await seedCustomer("longgone@example.com");
  const oldId = await insertSubscription(old.customerId, old.propertyId, "2025-01-15", 15);
  await db.query(
    `update subscriptions
        set status = 'canceled', ends_on = '2026-01-15', stripe_subscription_id = 'sub_old'
      where id = $1`,
    [oldId],
  );

  const { rows } = await db.query<{ subscription_id: string; ends_on: string }>(
    ENDED_MEMBERSHIPS_SQL,
    [today, CATCH_UP_DAYS, "America/Chicago"],
  );

  assert.deepEqual(
    rows.map((r) => r.subscription_id),
    [endedId],
    "only the paid membership that has actually ended, inside the catch-up window",
  );
  assert.equal(rows[0].ends_on, today);
});

test("the free add-on nudge skips tiers that have no free add-on", async () => {
  const { FREE_ADD_ON_NUDGE_SQL, FREE_ADD_ON_VISIT_COUNTS } = await import(
    "./emails/scheduled"
  );
  // Dated ahead of the real clock on purpose. The lateral join asks for the
  // next visit with now(), not with the date passed in, so a period in the
  // past matches nothing and the test would pass for the wrong reason.
  const today = "2027-06-10";

  // A period, a scheduled visit inside it, and no perk claimed. Everything the
  // nudge looks for, varying only the tier.
  async function memberDue(email: string, visitsPerPeriod: number, intervalDays: number | null) {
    const { customerId, propertyId } = await seedCustomer(email);
    const id = await insertSubscription(customerId, propertyId, "2027-06-01", 1);
    await db.query(
      `update subscriptions
          set status = 'active', visits_per_period = $2, interval_days = $3
        where id = $1`,
      [id, visitsPerPeriod, intervalDays],
    );
    const period = await db.query<{ id: string }>(
      `insert into subscription_periods
         (subscription_id, period_start, period_end, visits_allotted, amount_cents)
       values ($1, '2027-06-01', '2027-07-01', $2, 26900) returning id`,
      [id, visitsPerPeriod],
    );
    await db.query(
      `insert into visits (customer_id, property_id, subscription_id, period_id,
                           origin, service_type, status, scheduled_for)
       values ($1, $2, $3, $4, 'membership', 'standard', 'scheduled',
               '2027-06-20 09:00-05')`,
      [customerId, propertyId, id, period.rows[0].id],
    );
    return id;
  }

  const twice = await memberDue("nudge-twice@example.com", 2, null);
  await memberDue("nudge-once@example.com", 1, null);
  await memberDue("nudge-custom@example.com", 2, 21);

  const { rows } = await db.query<{ period_id: string }>(FREE_ADD_ON_NUDGE_SQL, [
    today,
    2,
    "America/Chicago",
    FREE_ADD_ON_VISIT_COUNTS,
  ]);

  const nudged = await db.query<{ subscription_id: string }>(
    `select subscription_id from subscription_periods where id = any($1::uuid[])`,
    [rows.map((r) => r.period_id)],
  );

  assert.deepEqual(
    nudged.rows.map((r) => r.subscription_id),
    [twice],
    "a once-a-month member has no free add-on, and a hand-agreed cadence never had one",
  );
});

test("a membership past its end date is closed, so the customer can come back", async () => {
  const { closeEndedMemberships } = await import("./membership-lifecycle");
  const today = "2026-06-01";

  const done = await seedCustomer("closeme@example.com");
  const doneId = await insertSubscription(done.customerId, done.propertyId, "2026-01-15", 15);
  await db.query(
    `update subscriptions set status = 'pending_cancellation', ends_on = $2::date where id = $1`,
    [doneId, today],
  );

  // Mid-notice. Their last period is still running and still owes cleanings.
  const notice = await seedCustomer("stillrunning@example.com");
  const noticeId = await insertSubscription(
    notice.customerId,
    notice.propertyId,
    "2026-01-15",
    15,
  );
  await db.query(
    `update subscriptions
        set status = 'pending_cancellation', ends_on = '2026-06-20' where id = $1`,
    [noticeId],
  );

  // At least this one. The database is shared across tests in this file, so
  // an exact count would be an assertion about the other tests.
  const closed = await closeEndedMemberships(asClient(db), today);
  assert.ok(closed >= 1);

  const states = await db.query<{ id: string; status: string }>(
    `select id, status::text as status from subscriptions where id = any($1::uuid[])`,
    [[doneId, noticeId]],
  );
  const byId = new Map(states.rows.map((r) => [r.id, r.status]));
  assert.equal(byId.get(doneId), "canceled", "its end date has arrived");
  assert.equal(
    byId.get(noticeId),
    "pending_cancellation",
    "cancelling early must not end the period they have already paid for",
  );

  // Running twice changes nothing, which matters because the cron retries.
  assert.equal(await closeEndedMemberships(asClient(db), today), 0);
});

test("the free add-on rule means the same thing in Postgres as it does in code", async () => {
  const { FREE_ADD_ON_NUDGE_SQL, FREE_ADD_ON_VISIT_COUNTS } = await import(
    "./emails/scheduled"
  );
  const { subscriptionIncludesFreeAddOn } = await import("./pricing");
  const today = "2027-08-10";

  // Every combination that can decide this: a decision made for the customer,
  // a published tier, and a cadence agreed by hand. The nudge query and the
  // function are written separately, one in SQL and one in TypeScript, and
  // they have to reach the same answer for all twelve.
  const cases: { override: boolean | null; intervalDays: number | null; visits: number }[] =
    [];
  for (const override of [null, true, false]) {
    for (const intervalDays of [null, 21]) {
      for (const visits of [1, 2]) {
        cases.push({ override, intervalDays, visits });
      }
    }
  }

  const made: { id: string; periodId: string; expected: boolean; label: string }[] = [];
  for (const [i, c] of cases.entries()) {
    const { customerId, propertyId } = await seedCustomer(`rule${i}@example.com`);
    const id = await insertSubscription(customerId, propertyId, "2027-08-01", 1);
    await db.query(
      `update subscriptions
          set status = 'active', visits_per_period = $2, interval_days = $3,
              free_add_on_override = $4
        where id = $1`,
      [id, c.visits, c.intervalDays, c.override],
    );
    const period = await db.query<{ id: string }>(
      `insert into subscription_periods
         (subscription_id, period_start, period_end, visits_allotted, amount_cents)
       values ($1, '2027-08-01', '2027-09-01', $2, 26900) returning id`,
      [id, c.visits],
    );
    await db.query(
      `insert into visits (customer_id, property_id, subscription_id, period_id,
                           origin, service_type, status, scheduled_for)
       values ($1, $2, $3, $4, 'membership', 'standard', 'scheduled',
               '2027-08-20 09:00-05')`,
      [customerId, propertyId, id, period.rows[0].id],
    );

    made.push({
      id,
      periodId: period.rows[0].id,
      expected: subscriptionIncludesFreeAddOn({
        intervalDays: c.intervalDays,
        visitsPerPeriod: c.visits,
        freeAddOnOverride: c.override,
      }),
      label: `override=${c.override} interval=${c.intervalDays} visits=${c.visits}`,
    });
  }

  const { rows } = await db.query<{ period_id: string }>(FREE_ADD_ON_NUDGE_SQL, [
    today,
    2,
    "America/Chicago",
    FREE_ADD_ON_VISIT_COUNTS,
  ]);
  const nudged = new Set(rows.map((r) => r.period_id));

  for (const m of made) {
    assert.equal(
      nudged.has(m.periodId),
      m.expected,
      `${m.label}: the query and the function disagree`,
    );
  }

  // And the answers are not all the same, which would make the above pass
  // while proving nothing.
  assert.ok(made.some((m) => m.expected));
  assert.ok(made.some((m) => !m.expected));
});

test("a pay-later booking reaches the board, and an abandoned checkout does not", async () => {
  const { customerId, propertyId } = await seedCustomer("paylater@example.com");
  const later = await insertSubscription(customerId, propertyId, "2027-03-01", 1);
  await db.query(
    `update subscriptions set payment_terms = 'later', interval_days = 21 where id = $1`,
    [later],
  );
  const abandoned = await insertSubscription(customerId, propertyId, "2027-03-01", 1);
  await db.query(`update subscriptions set interval_days = 21 where id = $1`, [
    abandoned,
  ]);

  const row = (id: string, terms: "on_booking" | "later"): SubscriptionRow => ({
    id,
    customer_id: customerId,
    property_id: propertyId,
    status: "pending_payment",
    monthly_amount_cents: 19500,
    visits_per_period: 1,
    pet_surcharge_cents: 0,
    interval_days: 21,
    payment_terms: terms,
        visit_time: "09:00",
    preferred_weekday: null,
    preferred_weekday_second: null,
    started_on: "2027-03-01",
    billing_day: 1,
    pending_amount_cents: null,
    pending_amount_effective_on: null,
    ends_on: null,
  });

  await generateForSubscription(asClient(db), row(later, "later"), "2027-03-01", "2027-03-01");
  await generateForSubscription(asClient(db), row(abandoned, "on_booking"), "2027-03-01", "2027-03-01");

  const states = await db.query<{
    subscription_id: string;
    status: string;
    payment_terms: string;
  }>(
    `select subscription_id, status::text as status, payment_terms::text as payment_terms
       from visits where subscription_id = any($1::uuid[])`,
    [[later, abandoned]],
  );

  const forLater = states.rows.filter((r) => r.subscription_id === later);
  const forAbandoned = states.rows.filter((r) => r.subscription_id === abandoned);
  assert.ok(forLater.length > 0 && forAbandoned.length > 0, "both should generate visits");

  // The board shows scheduled and assigned, and nothing else. This is the
  // whole mechanism: a job agreed on the phone can be staffed, and a checkout
  // somebody wandered away from cannot.
  assert.ok(
    forLater.every((r) => r.status === "scheduled"),
    "a pay-later booking must be a real job so a cleaner can be sent to it",
  );
  assert.ok(
    forAbandoned.every((r) => r.status === "pending_payment"),
    "an unpaid ordinary booking must stay off the board",
  );

  // And the terms travel down to the visit, or nothing could mark it unpaid.
  assert.ok(forLater.every((r) => r.payment_terms === "later"));
  assert.ok(forAbandoned.every((r) => r.payment_terms === "on_booking"));
});

test("an expiring checkout cancels an abandoned booking and never a staffed one", async () => {
  const { customerId, propertyId } = await seedCustomer("expiry@example.com");
  const made: Record<string, string> = {};
  for (const terms of ["on_booking", "later"] as const) {
    const id = await insertSubscription(customerId, propertyId, "2027-04-01", 1);
    // The table defaults to active; an unpaid booking is not.
    await db.query(
      `update subscriptions set payment_terms = $2, status = 'pending_payment'
        where id = $1`,
      [id, terms],
    );
    // A membership visit must belong to a period; the schema insists on it.
    const period = await db.query<{ id: string }>(
      `insert into subscription_periods
         (subscription_id, period_start, period_end, visits_allotted, amount_cents)
       values ($1, '2027-04-01', '2027-05-01', 1, 19500) returning id`,
      [id],
    );
    await db.query(
      `insert into visits (customer_id, property_id, subscription_id, period_id, origin,
                           service_type, status, scheduled_for, payment_terms)
       values ($1, $2, $3, $4, 'membership', 'standard', 'pending_payment',
               '2027-04-10 09:00-05', $5::payment_terms)`,
      [customerId, propertyId, id, period.rows[0].id, terms],
    );
    made[terms] = id;
  }

  // The statements the webhook runs when Stripe reports a session expired.
  for (const id of Object.values(made)) {
    await db.query(
      `update visits set status = 'canceled'
        where subscription_id = $1 and status = 'pending_payment'
          and payment_terms = 'on_booking'`,
      [id],
    );
    await db.query(
      `update subscriptions set status = 'canceled', ends_on = current_date
        where id = $1 and status = 'pending_payment' and payment_terms = 'on_booking'`,
      [id],
    );
  }

  const after = await db.query<{ id: string; status: string }>(
    `select id, status::text as status from subscriptions where id = any($1::uuid[])`,
    [Object.values(made)],
  );
  const byId = new Map(after.rows.map((r) => [r.id, r.status]));
  assert.equal(byId.get(made.on_booking), "canceled", "an abandoned checkout is cleared");
  assert.equal(
    byId.get(made.later),
    "pending_payment",
    "a job already on the board must survive its link expiring",
  );
});

test("a manual booking's first clean lands on the date that was agreed", async () => {
  const { customerId, propertyId } = await seedCustomer("agreeddate@example.com");
  const agreed = "2027-05-11";

  const made: Record<string, string> = {};
  for (const terms of ["on_booking", "later"] as const) {
    const id = await insertSubscription(customerId, propertyId, agreed, 11);
    await db.query(
      `update subscriptions
          set status = 'pending_payment', payment_terms = $2, interval_days = 21,
              visits_per_period = 1, preferred_weekday = null
        where id = $1`,
      [id, terms],
    );

    // Exactly what the booking action does: generate now, from the date that
    // was agreed. The daily job would not run until tomorrow and would then
    // refuse anything inside two days, which moved the visit off the date the
    // customer was given.
    await generateForSubscription(
      asClient(db),
      {
        id,
        customer_id: customerId,
        property_id: propertyId,
        status: "pending_payment",
        monthly_amount_cents: 19500,
        visits_per_period: 1,
        pet_surcharge_cents: 0,
        preferred_weekday: null,
        preferred_weekday_second: null,
        started_on: agreed,
        billing_day: 11,
        interval_days: 21,
        payment_terms: terms,
        visit_time: "09:00",
        pending_amount_cents: null,
        pending_amount_effective_on: null,
        ends_on: null,
      },
      agreed,
      agreed,
    );
    made[terms] = id;
  }

  for (const [terms, id] of Object.entries(made)) {
    const { rows } = await db.query<{ on_date: string }>(
      `select (scheduled_for at time zone 'America/Chicago')::date::text as on_date
         from visits where subscription_id = $1 order by scheduled_for`,
      [id],
    );
    assert.ok(rows.length > 0, `${terms} generated no visits at all`);
    assert.equal(
      rows[0].on_date,
      agreed,
      `${terms}: the first clean must fall on the date the customer was given`,
    );
  }

  const status = async (id: string) =>
    (
      await db.query<{ status: string }>(
        `select distinct status::text as status from visits where subscription_id = $1`,
        [id],
      )
    ).rows.map((r) => r.status);

  // Paid up front means the job stays off the board until Stripe says so.
  // Agreed and paying later means it is on the board and can be staffed.
  assert.deepEqual(await status(made.on_booking), ["pending_payment"]);
  assert.deepEqual(await status(made.later), ["scheduled"]);

  // When the payment lands, the webhook's own statement puts the pay-now one
  // on the board without waiting for tomorrow's cron.
  await db.query(
    `update visits set status = 'scheduled'
      where subscription_id = $1 and status = 'pending_payment'`,
    [made.on_booking],
  );
  assert.deepEqual(await status(made.on_booking), ["scheduled"]);
});

test("a cleaning keeps the time it was booked for", async () => {
  const { customerId, propertyId } = await seedCustomer("tenoclock@example.com");
  const agreed = "2027-09-14";
  const id = await insertSubscription(customerId, propertyId, agreed, 14);
  await db.query(
    `update subscriptions
        set status = 'pending_payment', payment_terms = 'later', interval_days = 21,
            visits_per_period = 1, preferred_weekday = null, visit_time = '10:00'
      where id = $1`,
    [id],
  );

  await generateForSubscription(
    asClient(db),
    {
      id,
      customer_id: customerId,
      property_id: propertyId,
      status: "pending_payment",
      monthly_amount_cents: 19500,
      visits_per_period: 1,
      pet_surcharge_cents: 0,
      preferred_weekday: null,
      preferred_weekday_second: null,
      started_on: agreed,
      billing_day: 14,
      interval_days: 21,
      payment_terms: "later",
      visit_time: "10:00",
      pending_amount_cents: null,
      pending_amount_effective_on: null,
      ends_on: null,
    },
    agreed,
    agreed,
  );

  const at = async () =>
    (
      await db.query<{ t: string }>(
        `select distinct to_char(scheduled_for at time zone 'America/Chicago', 'HH24:MI') as t
           from visits where subscription_id = $1`,
        [id],
      )
    ).rows.map((r) => r.t);

  // Every cleaning on the schedule, not only the first. A recurring customer
  // keeps their slot.
  assert.deepEqual(await at(), ["10:00"], "generated visits must use the agreed time");

  // Moving a visit changes the day and nothing else. Rewriting the time to
  // the default meant a ten o'clock customer quietly became a nine o'clock
  // one the first time anything was rescheduled, and nobody would be told.
  const [first] = (
    await db.query<{ id: string }>(
      `select id from visits where subscription_id = $1 order by scheduled_for limit 1`,
      [id],
    )
  ).rows;
  await db.query(
    `update visits
        set scheduled_for =
              (($2::date + (scheduled_for at time zone $3)::time) at time zone $3)
      where id = $1`,
    [first.id, "2027-09-16", "America/Chicago"],
  );

  const moved = await db.query<{ on_date: string; t: string }>(
    `select (scheduled_for at time zone 'America/Chicago')::date::text as on_date,
            to_char(scheduled_for at time zone 'America/Chicago', 'HH24:MI') as t
       from visits where id = $1`,
    [first.id],
  );
  assert.equal(moved.rows[0].on_date, "2027-09-16", "the day should move");
  assert.equal(moved.rows[0].t, "10:00", "the time should not");
});
