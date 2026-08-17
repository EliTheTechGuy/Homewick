import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * A signed link that stops the free add-on reminder.
 *
 * Signed rather than stored for the same reasons as a cleaner's job link:
 * nothing to keep tidy, no stale row that keeps working, and rotating the key
 * invalidates every outstanding link at once.
 *
 * Domain-separated from the job links, so a token minted for one can never be
 * valid for the other.
 *
 * It identifies a customer, so it must not be guessable: without the HMAC,
 * anybody could unsubscribe anybody by walking ids, and the first sign would
 * be members quietly stopping claiming the benefit they pay for.
 */

function key(): Buffer {
  const raw = process.env.ACCESS_SECRET_KEY;
  if (!raw) throw new Error("ACCESS_SECRET_KEY is not set.");
  return Buffer.from(raw, "base64");
}

function sign(customerId: string): string {
  return createHmac("sha256", key())
    .update(`unsubscribe:nudge:v1:${customerId}`)
    .digest("base64url");
}

export function unsubscribeToken(customerId: string): string {
  return sign(customerId);
}

export function unsubscribeTokenValid(customerId: string, token: string): boolean {
  let expected: string;
  try {
    expected = sign(customerId);
  } catch {
    return false;
  }
  const a = Buffer.from(expected);
  const b = Buffer.from(token);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function unsubscribeUrl(baseUrl: string, customerId: string): string {
  return `${baseUrl}/unsubscribe/${customerId}/${unsubscribeToken(customerId)}`;
}
