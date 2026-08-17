#!/usr/bin/env node
/**
 * Create an admin account, or print a sign-in link for one.
 *
 * There is a chicken and egg here: admin is passwordless, so the first account
 * cannot be created from inside admin. This is how it gets in, run by somebody
 * who already has the database URL, which is the same trust level.
 *
 *   npm run admin:add -- "Elisha Mabaje" you@example.com
 *   npm run admin:link -- you@example.com
 *   npm run admin:list
 */
import { createHash, randomBytes } from "node:crypto";
import pg from "pg";

function sslFor(cs) {
  try {
    const url = new URL(cs);
    const host = url.hostname.replace(/^\[|\]$/g, "");
    if (url.searchParams.get("sslmode") === "disable") return undefined;
    if (["localhost", "127.0.0.1", "::1"].includes(host)) return undefined;
  } catch {}
  const ca = process.env.DATABASE_CA_CERT?.trim();
  return ca ? { rejectUnauthorized: true, ca } : { rejectUnauthorized: false };
}

const [command, ...args] = process.argv.slice(2);
const cs = process.env.DATABASE_URL;
if (!cs) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

const base = process.env.ADMIN_URL ?? "http://localhost:3000";
const client = new pg.Client({ connectionString: cs, ssl: sslFor(cs) });
await client.connect();

try {
  if (command === "add") {
    const [name, email] = args;
    if (!name || !email) {
      console.error('Usage: npm run admin:add -- "Full Name" you@example.com');
      process.exit(1);
    }
    const { rows } = await client.query(
      `insert into admin_users (name, email) values ($1, $2)
       on conflict (email) do update set name = excluded.name, is_active = true
       returning id, name, email::text as email`,
      [name, email.toLowerCase()],
    );
    console.log(`\n${rows[0].name} <${rows[0].email}> can now sign in.`);
    await printLink(rows[0].id);
  } else if (command === "link") {
    const [email] = args;
    const { rows } = await client.query(
      `select id, name from admin_users where email = $1 and is_active = true`,
      [String(email).toLowerCase()],
    );
    if (!rows[0]) {
      console.error(`No active admin with that address.`);
      process.exit(1);
    }
    console.log(`\nSign-in link for ${rows[0].name}:`);
    await printLink(rows[0].id);
  } else if (command === "list") {
    const { rows } = await client.query(
      `select name, email::text as email, is_active,
              to_char(last_seen_at, 'YYYY-MM-DD HH24:MI') as last_seen
         from admin_users order by name`,
    );
    console.table(rows);
  } else {
    console.error(
      'Usage:\n  npm run admin:add -- "Full Name" you@example.com\n' +
        "  npm run admin:link -- you@example.com\n  npm run admin:list",
    );
    process.exit(1);
  }
} finally {
  await client.end();
}

async function printLink(adminUserId) {
  const token = randomBytes(32).toString("base64url");
  await client.query(
    `insert into admin_login_tokens (admin_user_id, token_hash, expires_at)
     values ($1, $2, now() + interval '60 minutes')`,
    [adminUserId, createHash("sha256").update(token).digest("hex")],
  );
  console.log(`\n  ${base}/admin/verify?token=${token}\n`);
  console.log("Valid for one hour, works once.\n");
}
