import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { query, queryOne, transaction } from "./db";

/**
 * Who is signed in to admin.
 *
 * Passwordless, the same shape as the member side. There is no password
 * anywhere in this product: nothing to leak, no reset flow, and no credential
 * living in the same database as the entry codes. Proving control of the
 * mailbox is the same proof a password reset would give, without the store.
 *
 * This replaces one shared password. That could not be revoked for one person,
 * recorded nobody's identity, and left access_reveals holding whatever name
 * the browser happened to send, which made the audit log worthless as evidence
 * of who opened a customer's door code.
 */

export const ADMIN_COOKIE = "hw_admin";

/** Sessions run from last use, so somebody working weekly never signs in twice. */
const SESSION_DAYS = 30;
const COOKIE_DAYS = 400;
const LINK_MINUTES = 15;
const MAX_LINKS_PER_HOUR = 5;

export type Admin = {
  id: string;
  email: string;
  name: string;
  /**
   * What goes in an audit row. A real, authenticated identity now, rather
   * than whatever string the browser chose to send, which is what made the
   * entry-code log worthless as evidence of who looked at what.
   */
  actor: string;
};

function hash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function newToken(): string {
  return randomBytes(32).toString("base64url");
}

export type AdminLinkRequest =
  | { sent: true; url: string; email: string; name: string }
  | { sent: false; reason: "unknown_email" | "rate_limited" };

/**
 * Mint a sign-in link.
 *
 * An unknown or deactivated address is reported to the caller, which
 * deliberately does not tell the visitor which. Admin is a smaller set than
 * the member list, so confirming an address exists is a stronger hint.
 */
export async function createAdminLoginLink(
  rawEmail: string,
  baseUrl: string,
  ip: string | null,
): Promise<AdminLinkRequest> {
  const email = rawEmail.trim().toLowerCase();

  const user = await queryOne<{ id: string; name: string }>(
    `select id, name from admin_users where email = $1 and is_active = true`,
    [email],
  );
  if (!user) return { sent: false, reason: "unknown_email" };

  const recent = await queryOne<{ count: string }>(
    `select count(*) as count from admin_login_tokens
      where admin_user_id = $1 and created_at > now() - interval '1 hour'`,
    [user.id],
  );
  if (Number(recent?.count ?? 0) >= MAX_LINKS_PER_HOUR) {
    return { sent: false, reason: "rate_limited" };
  }

  const token = newToken();
  await query(
    `insert into admin_login_tokens (admin_user_id, token_hash, expires_at, requested_ip)
     values ($1, $2, now() + ($3 || ' minutes')::interval, $4)`,
    [user.id, hash(token), String(LINK_MINUTES), ip],
  );

  return {
    sent: true,
    email,
    name: user.name,
    url: `${baseUrl}/admin/verify?token=${encodeURIComponent(token)}`,
  };
}

/**
 * Spend a link and open a session.
 *
 * Single use, enforced under a row lock inside the same transaction that
 * creates the session, so a mail scanner and a person racing the same link
 * cannot both end up signed in.
 */
export async function consumeAdminLoginToken(token: string): Promise<string | null> {
  return transaction(async (client) => {
    const { rows } = await client.query<{ id: string; admin_user_id: string }>(
      `select id, admin_user_id from admin_login_tokens
        where token_hash = $1 and used_at is null and expires_at > now()
        for update`,
      [hash(token)],
    );
    const found = rows[0];
    if (!found) return null;

    await client.query(`update admin_login_tokens set used_at = now() where id = $1`, [
      found.id,
    ]);

    const sessionToken = newToken();
    await client.query(
      `insert into admin_sessions (admin_user_id, token_hash, expires_at)
       values ($1, $2, now() + ($3 || ' days')::interval)`,
      [found.admin_user_id, hash(sessionToken), String(SESSION_DAYS)],
    );

    return sessionToken;
  });
}

/** The signed-in admin, or null. */
export async function currentAdmin(): Promise<Admin | null> {
  const token = (await cookies()).get(ADMIN_COOKIE)?.value;
  if (!token) return null;

  const row = await queryOne<{
    session_id: string;
    id: string;
    email: string;
    name: string;
  }>(
    `select s.id as session_id, u.id, u.email::text as email, u.name
       from admin_sessions s
       join admin_users u on u.id = s.admin_user_id
      where s.token_hash = $1
        and s.expires_at > now()
        and u.is_active = true`,
    [hash(token)],
  );

  if (!row) return null;

  // Sliding expiry, throttled by the predicate so ordinary use does not write
  // on every page load. Deactivating an account takes effect immediately
  // because is_active is checked above rather than only at sign-in.
  await query(
    `update admin_sessions
        set last_seen_at = now(),
            expires_at = now() + ($2 || ' days')::interval
      where id = $1 and last_seen_at < now() - interval '1 day'`,
    [row.session_id, String(SESSION_DAYS)],
  ).catch(() => {});

  return {
    id: row.id,
    email: row.email,
    name: row.name,
    actor: `${row.name} <${row.email}>`,
  };
}

/**
 * The signed-in admin, for code that cannot continue without one.
 *
 * Kept as a separate name from currentAdmin because the two read differently
 * at the call site: one asks, the other insists.
 */
export async function requireAdmin(): Promise<Admin | null> {
  return currentAdmin();
}

export async function endAdminSession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(ADMIN_COOKIE)?.value;
  if (token) {
    await query(`delete from admin_sessions where token_hash = $1`, [hash(token)]);
  }
  jar.delete(ADMIN_COOKIE);
}

export function adminCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    // Longer than the session on purpose: the row is what authorises, and it
    // slides. A cookie whose row has gone is an inert string.
    maxAge: COOKIE_DAYS * 24 * 60 * 60,
  };
}

/** Whether anybody can sign in at all. */
export async function isAdminConfigured(): Promise<boolean> {
  const row = await queryOne<{ n: number }>(
    `select count(*)::int as n from admin_users where is_active = true`,
  ).catch(() => null);
  return (row?.n ?? 0) > 0;
}
