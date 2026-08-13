#!/usr/bin/env node
/**
 * Applies pending migrations from db/migrations to DATABASE_URL.
 *
 * Files are plain SQL named NNNN_description.sql and run in filename order,
 * each inside its own transaction, and each recorded in schema_migrations so
 * it never runs twice. This is what lets the schema change on a database that
 * already holds real bookings — the earlier setup script could only ever
 * install into an empty database or drop everything and start again.
 *
 *   npm run db:migrate           apply anything pending
 *   npm run db:migrate -- --dry  list what would run, change nothing
 *
 * A database that already has the initial schema (applied before migrations
 * existed) is detected and baselined rather than re-run.
 */

import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
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
const dryRun = process.argv.includes("--dry");

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

async function readMigrations() {
  const dir = new URL("db/migrations/", root);
  const names = (await readdir(dir)).filter((n) => n.endsWith(".sql")).sort();
  return Promise.all(
    names.map(async (name) => {
      const sql = await readFile(new URL(name, dir), "utf8");
      return { name, sql, checksum: createHash("sha256").update(sql).digest("hex") };
    }),
  );
}

async function main() {
  await loadEnv();

  if (!process.env.DATABASE_URL) {
    console.error("\nDATABASE_URL is not set. See .env.example.\n");
    process.exit(1);
  }

  const migrations = await readMigrations();
  if (migrations.length === 0) {
    console.log("No migrations found in db/migrations.");
    return;
  }

  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: sslFor(process.env.DATABASE_URL),
  });
  await client.connect();

  const target = (() => {
    try {
      const u = new URL(process.env.DATABASE_URL);
      return `${u.hostname}${u.port ? `:${u.port}` : ""}`;
    } catch {
      return "(unknown host)";
    }
  })();
  console.log(`\nDatabase: ${target}`);

  await client.query(`
    create table if not exists schema_migrations (
      name        text primary key,
      checksum    text not null,
      applied_at  timestamptz not null default now()
    )
  `);

  // This table lives in the public schema, so on Supabase PostgREST would
  // serve it to anyone holding the anon key. It is only bookkeeping, but
  // there is no reason to publish the shape of our migration history.
  await client.query("alter table schema_migrations enable row level security");

  const { rows: appliedRows } = await client.query(
    "select name, checksum from schema_migrations",
  );
  const applied = new Map(appliedRows.map((r) => [r.name, r.checksum]));

  // A database created before migrations existed already has 0001's objects.
  // Record it as applied instead of trying to create the tables again.
  if (applied.size === 0) {
    const { rows } = await client.query(
      "select to_regclass('public.customers') is not null as installed",
    );
    if (rows[0].installed) {
      const first = migrations[0];
      if (!dryRun) {
        await client.query(
          "insert into schema_migrations (name, checksum) values ($1, $2)",
          [first.name, first.checksum],
        );
      }
      applied.set(first.name, first.checksum);
      console.log(`Baselined ${first.name} (its tables already exist).`);
    }
  }

  // A changed file that has already run means the two have diverged. Editing
  // an applied migration does not change the database; a new file must.
  for (const migration of migrations) {
    const previous = applied.get(migration.name);
    if (previous && previous !== migration.checksum) {
      console.error(
        `\n${migration.name} has already been applied but its contents have ` +
          `changed.\nAdd a new migration instead of editing an applied one.\n`,
      );
      await client.end();
      process.exit(1);
    }
  }

  const pending = migrations.filter((m) => !applied.has(m.name));

  if (pending.length === 0) {
    console.log("Up to date — nothing to apply.\n");
    await client.end();
    return;
  }

  console.log(`${pending.length} pending:`);
  for (const m of pending) console.log(`  ${m.name}`);

  if (dryRun) {
    console.log("\n--dry given: nothing was applied.\n");
    await client.end();
    return;
  }

  for (const migration of pending) {
    process.stdout.write(`\nApplying ${migration.name} … `);
    try {
      await client.query("begin");
      await client.query(migration.sql);
      await client.query(
        "insert into schema_migrations (name, checksum) values ($1, $2)",
        [migration.name, migration.checksum],
      );
      await client.query("commit");
      console.log("ok");
    } catch (err) {
      await client.query("rollback");
      console.error("failed — rolled back, database unchanged.\n");
      console.error(err.message);
      await client.end();
      process.exit(1);
    }
  }

  const { rows } = await client.query(
    `select count(*)::int as n from pg_tables
      where schemaname = 'public' and not rowsecurity`,
  );
  if (rows[0].n > 0) {
    console.warn(
      `\nWarning: ${rows[0].n} table(s) have no row-level security. On Supabase ` +
        `those are readable through PostgREST with the public anon key.`,
    );
  }

  console.log("\nDone.\n");
  await client.end();
}

await main();
