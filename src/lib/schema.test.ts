import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { decryptSecret, encryptSecret } from "./secrets";
import { beforeAll, afterAll, test } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { citext } from "@electric-sql/pglite/contrib/citext";
import { generateForSubscription, type SubscriptionRow } from "./membership-lifecycle";

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

test("schema applies cleanly and seeds launch pricing", async () => {
  const services = await db.query<{ count: number }>(
    "select count(*)::int as count from service_prices",
  );
  assert.equal(services.rows[0].count, 9);

  const memberships = await db.query<{ count: number }>(
    "select count(*)::int as count from membership_prices",
  );
  assert.equal(memberships.rows[0].count, 3);

  const perk = await db.query<{ code: string }>(
    "select code from add_ons where free_perk_eligible order by sort_order",
  );
  assert.deepEqual(
    perk.rows.map((r) => r.code),
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
