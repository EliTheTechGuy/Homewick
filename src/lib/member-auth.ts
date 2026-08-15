import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { query, queryOne, transaction } from "./db";

/**
 * Passwordless member sign-in.
 *
 * A member proves they control the email address they booked with. That is the
 * same proof a password reset provides, so a password would add a credential
 * store, in the same database as customers' door codes, without adding
 * security.
 *
 * Only hashes are stored. The raw token exists in the emailed URL and in the
 * member's cookie, so a database dump yields nothing replayable.
 */

export const SESSION_COOKIE = "hw_member";

/** Long enough that a member picking an add-on monthly is rarely signed out. */
const SESSION_DAYS = 30;

/** Short enough that a forwarded or logged link is not a standing key. */
const LINK_MINUTES = 15;

/** Cap on links per address per hour, so the form cannot be used to spam an inbox. */
const MAX_LINKS_PER_HOUR = 5;

function hash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function newToken(): string {
  return randomBytes(32).toString("base64url");
}

export type LinkRequest =
  | { sent: true; url: string; email: string }
  | { sent: false; reason: "unknown_email" | "rate_limited" };

/**
 * Mint a sign-in link for an email address.
 *
 * Returns the URL rather than sending it, so the caller decides the channel, * email in normal use, printed to the console by the support script.
 */
export async function createLoginLink(
  rawEmail: string,
  baseUrl: string,
  ip: string | null,
): Promise<LinkRequest> {
  const email = rawEmail.trim().toLowerCase();

  const customer = await queryOne<{ id: string }>(
    `select id from customers where email = $1`,
    [email],
  );

  // Accounts are created by booking, never by this form. An unknown address is
  // reported to the caller, which deliberately does not tell the visitor
  // whether it exists, see the action.
  if (!customer) return { sent: false, reason: "unknown_email" };

  const recent = await queryOne<{ count: string }>(
    `select count(*) as count from member_login_tokens
      where customer_id = $1 and created_at > now() - interval '1 hour'`,
    [customer.id],
  );
  if (Number(recent?.count ?? 0) >= MAX_LINKS_PER_HOUR) {
    return { sent: false, reason: "rate_limited" };
  }

  const token = newToken();
  await query(
    `insert into member_login_tokens (customer_id, token_hash, expires_at, requested_ip)
     values ($1, $2, now() + ($3 || ' minutes')::interval, $4)`,
    [customer.id, hash(token), String(LINK_MINUTES), ip],
  );

  return {
    sent: true,
    email,
    url: `${baseUrl}/account/verify?token=${encodeURIComponent(token)}`,
  };
}

/**
 * Spend a sign-in link and open a session.
 *
 * The token is marked used inside the same transaction that creates the
 * session, so a link that is clicked twice, by a mail scanner and then by the
 * member, say, cannot open two sessions.
 */
export async function consumeLoginToken(token: string): Promise<string | null> {
  if (!token) return null;

  return transaction(async (client) => {
    const { rows } = await client.query<{ id: string; customer_id: string }>(
      `select id, customer_id from member_login_tokens
        where token_hash = $1 and used_at is null and expires_at > now()
        for update`,
      [hash(token)],
    );

    const found = rows[0];
    if (!found) return null;

    await client.query(`update member_login_tokens set used_at = now() where id = $1`, [
      found.id,
    ]);

    const sessionToken = newToken();
    await client.query(
      `insert into member_sessions (customer_id, token_hash, expires_at)
       values ($1, $2, now() + ($3 || ' days')::interval)`,
      [found.customer_id, hash(sessionToken), String(SESSION_DAYS)],
    );

    return sessionToken;
  });
}

export type Member = {
  customerId: string;
  firstName: string;
  lastName: string;
  email: string;
};

/** The signed-in member, or null. Reads the cookie and validates it. */
export async function currentMember(): Promise<Member | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const row = await queryOne<{
    session_id: string;
    customer_id: string;
    first_name: string;
    last_name: string;
    email: string;
  }>(
    `select s.id as session_id, c.id as customer_id, c.first_name, c.last_name,
            c.email::text as email
       from member_sessions s
       join customers c on c.id = s.customer_id
      where s.token_hash = $1 and s.expires_at > now()`,
    [hash(token)],
  );

  if (!row) return null;

  // Cheap liveness marker; useful when someone asks "was this account used?"
  void query(`update member_sessions set last_seen_at = now() where id = $1`, [
    row.session_id,
  ]).catch(() => {});

  return {
    customerId: row.customer_id,
    firstName: row.first_name,
    lastName: row.last_name,
    email: row.email,
  };
}

export async function endSession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    await query(`delete from member_sessions where token_hash = $1`, [hash(token)]);
  }
  jar.delete(SESSION_COOKIE);
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  };
}

/** Constant-time compare, for anywhere a token is checked outside Postgres. */
export function tokensMatch(a: string, b: string): boolean {
  const x = Buffer.from(hash(a));
  const y = Buffer.from(hash(b));
  return x.length === y.length && timingSafeEqual(x, y);
}
