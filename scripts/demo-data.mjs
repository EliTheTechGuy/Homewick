/**
 * Seed a realistic day into the admin view, and take it away again.
 *
 * This exists so the operator can see what a working day actually looks like
 * before real customers arrive: a mix of memberships and one-offs, pets,
 * add-ons, entry codes, an assigned cleaner and an unassigned one.
 *
 * Everything it creates is tagged by email domain, and --clear removes exactly
 * and only those rows. Nothing here touches a real customer, and the demo
 * account used for the member-facing walkthrough is on a different domain so
 * it survives a clear.
 *
 *   node --env-file=.env.local scripts/demo-data.mjs --seed
 *   node --env-file=.env.local scripts/demo-data.mjs --seed --date 2026-08-20
 *   node --env-file=.env.local scripts/demo-data.mjs --clear
 */

import pg from "pg";
import { createCipheriv, randomBytes } from "node:crypto";

const DEMO_DOMAIN = "@example.invalid";
const TZ = "America/Chicago";

function sslFor(connectionString) {
  const local = /localhost|127\.0\.0\.1|\[?::1\]?/.test(connectionString ?? "");
  if (local || /sslmode=disable/.test(connectionString ?? "")) return false;
  return { rejectUnauthorized: false };
}

/** Same layout as src/lib/secrets.ts: [12-byte IV][16-byte tag][ciphertext]. */
function encryptSecret(plaintext) {
  const raw = process.env.ACCESS_SECRET_KEY;
  if (!raw || !plaintext) return null;
  const key = Buffer.from(raw, "base64");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]);
}

function todayInTexas() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
}

/**
 * The cast of a plausible morning. Times are spread across the day so the
 * ordering in the admin list is obvious at a glance.
 */
const PEOPLE = [
  {
    first: "Marcus", last: "Whitfield", phone: "214-555-0142",
    line1: "3110 Cole Ave", line2: "Apt 218", city: "Dallas", zip: "75204",
    size: "2br_2ba", pets: true, origin: "membership", service: "standard",
    at: "08:00", base: 13500, pet: 0, addons: 3500,
    addOnCodes: [["oven", true]],
    instructions: "Please start with the kitchen, working from home in the back bedroom.",
    entry: { kind: "door_code", value: "4417#" },
    assignCleaner: true,
  },
  {
    first: "Priya", last: "Raghunathan", phone: "469-555-0188",
    line1: "5401 Belt Line Rd", line2: "Unit 1204", city: "Dallas", zip: "75254",
    size: "studio_1br", pets: false, origin: "one_off", service: "deep",
    at: "09:30", base: 16900, pet: 0, addons: 4500,
    addOnCodes: [["windows", false]],
    instructions: "Moving out Friday, landlord inspection Saturday.",
    entry: { kind: "gate_code", value: "2280" },
    assignCleaner: true,
  },
  {
    first: "Dana", last: "Okonkwo", phone: "972-555-0119",
    line1: "1200 Main St", line2: "Apt 1710", city: "Dallas", zip: "75202",
    size: "3br_2ba", pets: true, origin: "membership", service: "standard",
    at: "11:00", base: 18500, pet: 0, addons: 0,
    addOnCodes: [],
    instructions: null,
    entry: { kind: "lobby", value: null },
    assignCleaner: false,
  },
  {
    first: "Tomas", last: "Lindgren", phone: "214-555-0173",
    line1: "2801 Routh St", line2: "Apt 402", city: "Dallas", zip: "75201",
    size: "studio_1br", pets: false, origin: "one_off", service: "standard",
    at: "13:30", base: 11000, pet: 1500, addons: 2500,
    addOnCodes: [["balcony", false]],
    instructions: "Cat is friendly but bolts, please keep the front door shut.",
    entry: { kind: "key_location", value: "Front desk, ask for 402 spare" },
    assignCleaner: false,
  },
];

const args = process.argv.slice(2);
const wantsSeed = args.includes("--seed");
const wantsClear = args.includes("--clear");
const dateArg = args[args.indexOf("--date") + 1];
const day = args.includes("--date") && dateArg ? dateArg : todayInTexas();

if (!wantsSeed && !wantsClear) {
  console.log("Pass --seed or --clear. Optionally --date YYYY-MM-DD with --seed.");
  process.exit(1);
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

const client = new pg.Client({ connectionString, ssl: sslFor(connectionString) });

async function clear() {
  // Ordered so foreign keys never block a delete. Everything is scoped to the
  // demo email domain, so a real customer cannot be caught by this.
  const scope = `select id from customers where email like '%${DEMO_DOMAIN}'`;
  const steps = [
    `delete from visit_add_ons where visit_id in (select id from visits where customer_id in (${scope}))`,
    `delete from visit_photos  where visit_id in (select id from visits where customer_id in (${scope}))`,
    `delete from visit_feedback where visit_id in (select id from visits where customer_id in (${scope}))`,
    `delete from access_reveals where property_id in (select id from properties where customer_id in (${scope}))`,
    `delete from visits where customer_id in (${scope})`,
    `delete from subscription_periods where subscription_id in (select id from subscriptions where customer_id in (${scope}))`,
    `delete from subscriptions where customer_id in (${scope})`,
    `delete from property_access_secrets where property_id in (select id from properties where customer_id in (${scope}))`,
    `delete from properties where customer_id in (${scope})`,
    `delete from service_agreements where customer_id in (${scope})`,
    `delete from email_deliveries where customer_id in (${scope})`,
    `delete from member_sessions where customer_id in (${scope})`,
    `delete from member_login_tokens where customer_id in (${scope})`,
    `delete from cleaners where email like '%${DEMO_DOMAIN}'`,
    `delete from customers where email like '%${DEMO_DOMAIN}'`,
  ];
  let removed = 0;
  for (const sql of steps) {
    const r = await client.query(sql);
    removed += r.rowCount ?? 0;
  }
  console.log(`Cleared ${removed} demo rows.`);
}

async function seed() {
  const { rows: cleanerRows } = await client.query(
    `insert into cleaners (first_name, last_name, phone, email, hired_on, is_active)
     values ('Rosa', 'Delgado', '214-555-0100', 'rosa${DEMO_DOMAIN}', current_date - 90, true)
     returning id`,
  );
  const cleanerId = cleanerRows[0].id;

  for (const p of PEOPLE) {
    const email = `${p.first.toLowerCase()}.${p.last.toLowerCase()}${DEMO_DOMAIN}`;

    const { rows: cust } = await client.query(
      `insert into customers (first_name, last_name, email, phone)
       values ($1,$2,$3,$4) returning id`,
      [p.first, p.last, email, p.phone],
    );
    const customerId = cust[0].id;

    const { rows: prop } = await client.query(
      `insert into properties
         (customer_id, line1, line2, city, state, postal_code, unit_size, has_pets)
       values ($1,$2,$3,$4,'TX',$5,$6,$7) returning id`,
      [customerId, p.line1, p.line2, p.city, p.zip, p.size, p.pets],
    );
    const propertyId = prop[0].id;

    if (p.entry.value) {
      const enc = encryptSecret(p.entry.value);
      await client.query(
        `insert into property_access_secrets
           (property_id, gate_code_enc, door_code_enc, key_location_enc)
         values ($1,$2,$3,$4)`,
        [
          propertyId,
          p.entry.kind === "gate_code" ? enc : null,
          p.entry.kind === "door_code" ? enc : null,
          p.entry.kind === "key_location" ? enc : null,
        ],
      );
    }

    // A membership visit must belong to a period; a one-off must not. The
    // check constraint on visits enforces exactly that, so build accordingly.
    let subscriptionId = null;
    let periodId = null;

    if (p.origin === "membership") {
      const monthly = { studio_1br: 18900, "2br_2ba": 26900, "3br_2ba": 36900 }[p.size];
      const { rows: sub } = await client.query(
        `insert into subscriptions
           (customer_id, property_id, unit_size, status, monthly_amount_cents,
            visits_per_period, pet_surcharge_cents, preferred_weekday,
            started_on, billing_day, stripe_subscription_id)
         values ($1,$2,$3,'active',$4,2,0,null, $5::date - 40, 1, $6)
         returning id`,
        [customerId, propertyId, p.size, monthly, day, `sub_demo_${customerId.slice(0, 8)}`],
      );
      subscriptionId = sub[0].id;

      const { rows: period } = await client.query(
        `insert into subscription_periods
           (subscription_id, period_start, period_end, amount_cents,
            visits_allotted, visits_used, free_addon_used)
         values ($1, date_trunc('month', $2::date)::date,
                    (date_trunc('month', $2::date) + interval '1 month')::date,
                 $3, 2, 1, $4)
         returning id`,
        [subscriptionId, day, monthly, p.addOnCodes.some(([, free]) => free)],
      );
      periodId = period[0].id;
    }

    const { rows: visit } = await client.query(
      `insert into visits
         (customer_id, property_id, subscription_id, period_id, origin,
          service_type, status, scheduled_for, assigned_cleaner_id,
          base_amount_cents, pet_surcharge_cents, addons_amount_cents,
          customer_instructions, stripe_payment_intent_id)
       values ($1,$2,$3,$4,$5,$6,$7, (($8::date + $9::time) at time zone $10),
               $11,$12,$13,$14,$15,$16)
       returning id`,
      [
        customerId, propertyId, subscriptionId, periodId, p.origin,
        p.service, p.assignCleaner ? "assigned" : "scheduled",
        day, p.at, TZ,
        p.assignCleaner ? cleanerId : null,
        p.base, p.pet, p.addons, p.instructions,
        `pi_demo_${customerId.slice(0, 8)}`,
      ],
    );

    for (const [code, isFree] of p.addOnCodes) {
      const { rows: addOn } = await client.query(
        `select id, price_cents from add_ons where code = $1`,
        [code],
      );
      if (!addOn[0]) continue;
      await client.query(
        `insert into visit_add_ons (visit_id, add_on_id, price_cents_at_time, is_free_perk)
         values ($1,$2,$3,$4)`,
        [visit[0].id, addOn[0].id, isFree ? 0 : addOn[0].price_cents, isFree],
      );
    }

    console.log(`  ${p.at}  ${p.first} ${p.last}  ${p.origin}  ${p.assignCleaner ? "assigned" : "unassigned"}`);
  }
}

(async () => {
  await client.connect();
  try {
    await client.query("begin");
    // Always clear first so re-seeding does not stack duplicates.
    await clear();
    if (wantsSeed) {
      console.log(`\nSeeding a day for ${day}:`);
      await seed();
      console.log(`\nOpen /admin?date=${day}`);
    }
    await client.query("commit");
  } catch (err) {
    await client.query("rollback");
    console.error("\nNothing was changed.\n", err.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
})();
