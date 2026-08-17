import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { query, queryOne } from "./db";
import { verifyPassword } from "./passwords";

/**
 * Who is signed in to admin.
 *
 * An account per person, with a password. This replaces one shared password
 * that could not be revoked for a single person, recorded nobody's identity,
 * and left access_reveals holding whatever name the browser happened to send,
 * which made the audit log worthless as evidence of who opened a customer's
 * door code.
 *
 * There is deliberately no reset-by-email. It would mean anybody who took the
 * mailbox could take admin, which is the thing choosing a password was meant
 * to avoid. Recovery is a command run by somebody who already holds the
 * database credentials, which is the same level of trust as the data itself.
 */

export const ADMIN_COOKIE = "hw_admin";

/** Sessions run from last use, so somebody working weekly never signs in twice. */
const SESSION_DAYS = 30;
const COOKIE_DAYS = 400;
/**
 * Verified against when no account matches, so a wrong address costs the same
 * as a wrong password. The value never matches anything.
 */
const DUMMY_HASH =
  "scrypt$32768$8$1$00000000000000000000000000000000$" + "0".repeat(128);

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

/**
 * Check an email and password, and open a session if they match.
 *
 * One answer for every kind of failure: unknown address, wrong password,
 * deactivated account. Telling them apart would confirm which addresses can
 * reach admin, and that is a shorter list than the member one.
 *
 * The hash is verified even when no account was found, against a throwaway
 * value. Otherwise an unknown address returns in a millisecond while a real
 * one takes a tenth of a second, and the timing answers the question the
 * message refuses to.
 */
export async function signInWithPassword(
  rawEmail: string,
  password: string,
): Promise<string | null> {
  const email = rawEmail.trim().toLowerCase();

  const user = await queryOne<{ id: string; password_hash: string | null }>(
    `select id, password_hash from admin_users
      where email = $1 and is_active = true`,
    [email],
  );

  const ok = await verifyPassword(password, user?.password_hash ?? DUMMY_HASH);
  if (!user || !ok) return null;

  const sessionToken = newToken();
  await query(
    `insert into admin_sessions (admin_user_id, token_hash, expires_at)
     values ($1, $2, now() + ($3 || \' days\')::interval)`,
    [user.id, hash(sessionToken), String(SESSION_DAYS)],
  );
  await query(`update admin_users set last_seen_at = now() where id = $1`, [user.id]);

  return sessionToken;
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
