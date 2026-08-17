#!/usr/bin/env node
/**
 * Create an admin account, or set its password.
 *
 * There is a chicken and egg: the first account cannot be created from inside
 * admin. This is how it gets in, run by somebody who already has the database
 * URL, which is the same level of trust as the data itself.
 *
 * It is also the recovery path. There is deliberately no reset by email,
 * because that would mean whoever took the mailbox took admin, which is the
 * thing choosing a password was meant to avoid.
 *
 *   npm run admin:add -- "Elisha Mabaje" you@example.com
 *   npm run admin:password -- you@example.com
 *   npm run admin:list
 */
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { createInterface } from "node:readline/promises";
import pg from "pg";

// 128 * N * r is exactly 32MB here, which is also Node's default ceiling,
// so it has to be raised or every hash throws.
const N = 32768, r = 8, p = 1, maxmem = 64 * 1024 * 1024;

function hashPassword(password) {
  return new Promise((resolve, reject) => {
    const salt = randomBytes(16);
    scrypt(password.normalize("NFKC"), salt, 64, { N, r, p, maxmem }, (err, key) =>
      err ? reject(err) : resolve(`scrypt$${N}$${r}$${p}$${salt.toString("hex")}$${key.toString("hex")}`),
    );
  });
}

/** Asked for rather than passed as an argument, so it stays out of shell history. */
async function askPassword() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const first = await rl.question("New password (at least 12 characters): ");
  const again = await rl.question("Again: ");
  rl.close();
  if (first !== again) {
    console.error("\nThose did not match.");
    process.exit(1);
  }
  if (first.length < 12) {
    console.error("\nToo short. Use at least 12 characters; a few unrelated words works well.");
    process.exit(1);
  }
  return first;
}

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
    const password = await askPassword();
    await client.query(`update admin_users set password_hash = $2 where id = $1`, [
      rows[0].id,
      await hashPassword(password),
    ]);
    console.log(`\n${rows[0].name} <${rows[0].email}> can now sign in at ${base}/admin/sign-in\n`);
  } else if (command === "password") {
    const [email] = args;
    const { rows } = await client.query(
      `select id, name from admin_users where email = $1 and is_active = true`,
      [String(email).toLowerCase()],
    );
    if (!rows[0]) {
      console.error("No active admin with that address.");
      process.exit(1);
    }
    const password = await askPassword();
    await client.query(`update admin_users set password_hash = $2 where id = $1`, [
      rows[0].id,
      await hashPassword(password),
    ]);
    console.log(`\nPassword set for ${rows[0].name}.\n`);
  } else if (command === "list") {
    const { rows } = await client.query(
      `select name, email::text as email, is_active,
              (password_hash is not null) as can_sign_in,
              to_char(last_seen_at, 'YYYY-MM-DD HH24:MI') as last_seen
         from admin_users order by name`,
    );
    console.table(rows);
  } else {
    console.error(
      'Usage:\n  npm run admin:add -- "Full Name" you@example.com\n' +
        "  npm run admin:password -- you@example.com\n  npm run admin:list",
    );
    process.exit(1);
  }
} finally {
  await client.end();
}

