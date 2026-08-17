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
