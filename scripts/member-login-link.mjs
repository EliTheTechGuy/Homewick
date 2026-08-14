#!/usr/bin/env node
/**
 * Mint a member sign-in link and print it.
 *
 *   npm run member:link -- someone@example.com
 *
 * Two uses. Testing, before an email provider is configured. And support: a
 * member whose email is broken can be read a working link over the phone.
 *
 * The link is single-use and expires in 15 minutes, same as an emailed one.
 * Printing it here does not weaken anything — whoever can run this already has
 * the database credentials.
 */

import { readFile } from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";
import pg from "pg";

function sslFor(connectionString) {
  let host = "";
  let sslmode = null;
  try {
    const url = new URL(connectionString);
    host = url.hostname.replace(/^\[|\]$/g, "");
    sslmode = url.searchParams.get("sslmode");
  } catch {
    // Unparseable strings get the safe, TLS-on default.
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
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/i);
        if (!m || process.env[m[1]]) continue;
        process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
      }
      return;
    } catch {
      // try the next candidate
    }
  }
}

await loadEnv();

const email = process.argv[2]?.trim().toLowerCase();
if (!email) {
  console.error("\nUsage: npm run member:link -- someone@example.com\n");
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set. See .env.example.");
  process.exit(1);
}

const baseUrl = process.argv[3] || process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: sslFor(process.env.DATABASE_URL),
});
await client.connect();

const { rows } = await client.query(
  "select id, first_name, last_name from customers where email = $1",
  [email],
);

if (rows.length === 0) {
  console.error(
    `\nNo customer with that email. Accounts are created by booking, not by this script.\n`,
  );
  await client.end();
  process.exit(1);
}

const token = randomBytes(32).toString("base64url");
await client.query(
  `insert into member_login_tokens (customer_id, token_hash, expires_at)
   values ($1, $2, now() + interval '15 minutes')`,
  [rows[0].id, createHash("sha256").update(token).digest("hex")],
);

console.log(`\nSign-in link for ${rows[0].first_name} ${rows[0].last_name} <${email}>`);
console.log(`Single use, expires in 15 minutes.\n`);
console.log(`${baseUrl}/account/verify?token=${encodeURIComponent(token)}\n`);

await client.end();
