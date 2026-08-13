#!/usr/bin/env node
/**
 * Applies db/schema.sql to the database in DATABASE_URL.
 *
 * Reads .env.local itself so the connection string never has to be pasted
 * onto a command line, into a shell history, or into a chat window.
 *
 *   npm run db:setup           apply the schema
 *   npm run db:setup -- --force   drop and recreate first (destructive)
 */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
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
const force = process.argv.includes("--force");

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
      console.log(`Loaded ${file}`);
      return;
    } catch {
      // try the next candidate
    }
  }
}

await loadEnv();

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error(
    "\nDATABASE_URL is not set.\n\n" +
      "Create .env.local from .env.example and paste your Supabase connection\n" +
      "string into it. In Supabase: Project Settings → Database → Connection\n" +
      "string → URI. Use the pooled (port 6543) string for the app; either\n" +
      "works for this script.\n",
  );
  process.exit(1);
}

// Never print the password, but do confirm which host is about to be changed.
const target = (() => {
  try {
    const url = new URL(connectionString);
    return `${url.hostname}${url.port ? `:${url.port}` : ""}${url.pathname}`;
  } catch {
    return "(unparseable connection string)";
  }
})();

const client = new pg.Client({
  connectionString,
  ssl: sslFor(connectionString),
});

console.log(`Connecting to ${target} …`);
await client.connect();

const { rows } = await client.query(
  "select to_regclass('public.customers') is not null as installed",
);

if (rows[0].installed && !force) {
  console.log(
    "\nSchema is already installed — nothing to do.\n" +
      "Re-run with `npm run db:setup -- --force` to drop and recreate it.\n" +
      "That deletes every row. Do not do it on a database with real bookings.\n",
  );
  await client.end();
  process.exit(0);
}

if (force) {
  console.log("\n--force given: dropping existing Homewick objects …");
  await client.query(`
    drop table if exists visit_feedback, visit_photos, visit_add_ons, visits,
      subscription_periods, subscriptions, service_agreements, access_reveals,
      property_access_secrets, properties, add_ons, membership_prices,
      service_prices, cleaners, customers cascade;
    drop type if exists unit_size, service_type, subscription_state, visit_state,
      visit_origin, photo_kind, feedback_channel, recovery_state cascade;
  `);
}

const sql = await readFile(new URL("db/schema.sql", root), "utf8");

try {
  await client.query("begin");
  await client.query(sql);
  await client.query("commit");
} catch (err) {
  await client.query("rollback");
  console.error("\nSchema failed to apply — nothing was changed.\n");
  console.error(err.message);
  await client.end();
  process.exit(1);
}

const summary = await client.query(`
  select
    (select count(*) from service_prices)    as service_prices,
    (select count(*) from membership_prices) as membership_prices,
    (select count(*) from add_ons)           as add_ons,
    (select count(*) from pg_tables
      where schemaname = 'public' and not rowsecurity) as tables_without_rls
`);

const s = summary.rows[0];
console.log("\nSchema applied.");
console.log(`  service_prices     ${s.service_prices}`);
console.log(`  membership_prices  ${s.membership_prices}`);
console.log(`  add_ons            ${s.add_ons}`);
console.log(`  tables without RLS ${s.tables_without_rls}`);

if (Number(s.tables_without_rls) > 0) {
  console.warn(
    "\nWarning: some tables have no row-level security. On Supabase those are\n" +
      "readable through PostgREST with the public anon key.\n",
  );
}

console.log("\nNext: npm run db:check   (end-to-end test, rolled back afterwards)\n");
await client.end();
