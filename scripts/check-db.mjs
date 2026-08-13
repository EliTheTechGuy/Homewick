#!/usr/bin/env node
/**
 * End-to-end check against the real database in DATABASE_URL.
 *
 * Everything runs inside a transaction that is rolled back at the end, so a
 * live database with real bookings is left byte-for-byte unchanged. It proves
 * the parts that unit tests cannot: that this particular database accepts the
 * schema's constraints, that entry-code encryption round-trips against a real
 * bytea column, and that a membership signup generates the visits it should.
 *
 *   npm run db:check
 */

import { readFile } from "node:fs/promises";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import pg from "pg";

/** Hosted Postgres needs TLS; a local one has no certificate and refuses it. */
function sslFor(connectionString) {
  let host = "";
  let sslmode = null;
  try {
    const url = new URL(connectionString);
    host = url.hostname.replace(/^\[|\]$/g, "");
    sslmode = url.searchParams.get("sslmode");
  } catch {
    // An unparseable string gets the safe, TLS-on default.
  }
  if (sslmode === "disable") return undefined;
  if (host === "localhost" || host === "127.0.0.1" || host === "::1") return undefined;
  return { rejectUnauthorized: false };
}


const root = new URL("..", import.meta.url);

async function loadEnv() {
  for (const file of [".env.local", ".env"]) {
    try {
      const text = await readFile(new URL(file, root), "utf8");
      for (const line of text.split("\n")) {
        const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/i);
        if (!match) continue;
        const [, key, rawValue] = match;
        if (process.env[key]) continue;
        process.env[key] = rawValue.trim().replace(/^["']|["']$/g, "");
      }
      return;
    } catch {
      // try the next candidate
    }
  }
}

await loadEnv();

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set. See .env.example.");
  process.exit(1);
}

const checks = [];
const record = (name, ok, detail = "") => {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "  ok  " : " FAIL "} ${name}${detail ? ` — ${detail}` : ""}`);
};

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: sslFor(process.env.DATABASE_URL),
});

await client.connect();
console.log("\nRunning checks inside a transaction that will be rolled back.\n");
await client.query("begin");

try {
  // --- seed data ------------------------------------------------------
  const prices = await client.query("select count(*)::int as n from service_prices");
  record("launch pricing is seeded", prices.rows[0].n === 9, `${prices.rows[0].n} rows`);

  const perks = await client.query(
    "select count(*)::int as n from add_ons where free_perk_eligible",
  );
  record("four add-ons are free-perk eligible", perks.rows[0].n === 4, `${perks.rows[0].n}`);

  // --- row-level security --------------------------------------------
  const rls = await client.query(
    `select count(*)::int as n from pg_tables
      where schemaname = 'public' and not rowsecurity`,
  );
  record(
    "no public table is missing row-level security",
    rls.rows[0].n === 0,
    `${rls.rows[0].n} unprotected`,
  );

  // --- constraints ----------------------------------------------------
  const customer = await client.query(
    `insert into customers (first_name, last_name, email, phone)
     values ('Check', 'Run', $1, '555-0100') returning id`,
    [`db-check-${Date.now()}@example.invalid`],
  );
  const customerId = customer.rows[0].id;

  const property = await client.query(
    `insert into properties (customer_id, line1, city, postal_code, unit_size, has_pets)
     values ($1, '1 Test St', 'Dallas', '75201', '2br_2ba', true) returning id`,
    [customerId],
  );
  const propertyId = property.rows[0].id;

  await client.query("savepoint s1");
  try {
    await client.query(
      `insert into subscriptions
         (customer_id, property_id, unit_size, monthly_amount_cents, started_on, billing_day)
       values ($1, $2, '2br_2ba', 26900, current_date, 31)`,
      [customerId, propertyId],
    );
    await client.query("rollback to savepoint s1");
    record("billing_day above 28 is rejected", false, "it was accepted");
  } catch {
    await client.query("rollback to savepoint s1");
    record("billing_day above 28 is rejected", true);
  }

  await client.query("savepoint s2");
  try {
    await client.query(
      `insert into visits (customer_id, property_id, origin, service_type, scheduled_for)
       values ($1, $2, 'membership', 'standard', now())`,
      [customerId, propertyId],
    );
    await client.query("rollback to savepoint s2");
    record("a membership visit without a period is rejected", false, "it was accepted");
  } catch {
    await client.query("rollback to savepoint s2");
    record("a membership visit without a period is rejected", true);
  }

  // --- entry-code encryption round-trip -------------------------------
  const key = process.env.ACCESS_SECRET_KEY
    ? Buffer.from(process.env.ACCESS_SECRET_KEY, "base64")
    : null;

  if (!key || key.length !== 32) {
    record(
      "entry-code encryption round-trips",
      false,
      "ACCESS_SECRET_KEY missing or not 32 bytes of base64",
    );
  } else {
    const plaintext = "gate 4821 then unit 410";
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const stored = Buffer.concat([iv, cipher.getAuthTag(), body]);

    await client.query(
      `insert into property_access_secrets (property_id, door_code_enc)
       values ($1, $2)`,
      [propertyId, stored],
    );

    const back = await client.query(
      "select door_code_enc from property_access_secrets where property_id = $1",
      [propertyId],
    );
    const raw = back.rows[0].door_code_enc;
    const decipher = createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    const decrypted = Buffer.concat([
      decipher.update(raw.subarray(28)),
      decipher.final(),
    ]).toString("utf8");

    record("entry-code encryption round-trips through bytea", decrypted === plaintext);
  }

  // --- a membership signup generates its visits -----------------------
  const sub = await client.query(
    `insert into subscriptions
       (customer_id, property_id, unit_size, monthly_amount_cents,
        pet_surcharge_cents, preferred_weekday, started_on, billing_day)
     values ($1, $2, '2br_2ba', 26900, 1500, 4, date '2026-01-15', 15)
     returning id`,
    [customerId, propertyId],
  );
  const subscriptionId = sub.rows[0].id;

  const period = await client.query(
    `insert into subscription_periods
       (subscription_id, period_start, period_end, visits_allotted, amount_cents)
     values ($1, date '2026-01-15', date '2026-02-15', 2, 26900)
     returning id`,
    [subscriptionId],
  );
  const periodId = period.rows[0].id;

  for (const day of ["2026-01-15", "2026-01-29"]) {
    await client.query(
      `insert into visits
         (customer_id, property_id, subscription_id, period_id, origin,
          service_type, scheduled_for, pet_surcharge_cents)
       values ($1, $2, $3, $4, 'membership', 'standard',
               (($5::date + '09:00'::time) at time zone 'America/Chicago'), 1500)`,
      [customerId, propertyId, subscriptionId, periodId, day],
    );
  }

  const placed = await client.query(
    `select (scheduled_for at time zone 'America/Chicago')::date::text as d
       from visits where subscription_id = $1 order by scheduled_for`,
    [subscriptionId],
  );
  record(
    "visit dates survive the timezone conversion",
    placed.rows.map((r) => r.d).join(",") === "2026-01-15,2026-01-29",
    placed.rows.map((r) => r.d).join(", "),
  );

  // --- the free perk can only be claimed once -------------------------
  const visitId = (
    await client.query("select id from visits where subscription_id = $1 limit 1", [
      subscriptionId,
    ])
  ).rows[0].id;

  const eligible = await client.query(
    "select id from add_ons where free_perk_eligible order by sort_order limit 2",
  );

  await client.query(
    `insert into visit_add_ons (visit_id, add_on_id, price_cents_at_time, is_free_perk)
     values ($1, $2, 0, true)`,
    [visitId, eligible.rows[0].id],
  );

  await client.query("savepoint s3");
  try {
    await client.query(
      `insert into visit_add_ons (visit_id, add_on_id, price_cents_at_time, is_free_perk)
       values ($1, $2, 0, true)`,
      [visitId, eligible.rows[1].id],
    );
    await client.query("rollback to savepoint s3");
    record("a second free perk on one visit is rejected", false, "it was accepted");
  } catch {
    await client.query("rollback to savepoint s3");
    record("a second free perk on one visit is rejected", true);
  }
} catch (err) {
  console.error("\nCheck run aborted:", err.message);
  checks.push({ name: "check run completed", ok: false });
} finally {
  await client.query("rollback");
  await client.end();
}

const failed = checks.filter((c) => !c.ok);
console.log(
  `\n${checks.length - failed.length}/${checks.length} passed. ` +
    "Transaction rolled back — no rows were left behind.\n",
);
process.exit(failed.length === 0 ? 0 : 1);
