import { headers } from "next/headers";

/**
 * Admin is gated by a shared password sent as HTTP Basic auth. That is
 * deliberately minimal for a single-operator business, but it is a real gate:
 * the admin view can reveal entry codes, so it must never be open.
 */

export type AdminIdentity = { actor: string };

export async function requireAdmin(): Promise<AdminIdentity | null> {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return null;

  const header = (await headers()).get("authorization");
  if (!header?.startsWith("Basic ")) return null;

  const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
  const separator = decoded.indexOf(":");
  if (separator === -1) return null;

  const user = decoded.slice(0, separator);
  const password = decoded.slice(separator + 1);

  if (!timingSafeEqual(password, expected)) return null;
  return { actor: user || "admin" };
}

export function isAdminConfigured(): boolean {
  return Boolean(process.env.ADMIN_PASSWORD);
}

/** Constant-time comparison, so the password can't be guessed a byte at a time. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}
