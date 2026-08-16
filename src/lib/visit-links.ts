import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * A signed link to one visit, for a cleaner who has no account.
 *
 * Cleaners are staff, not users. Giving them logins to maintain, or handing
 * out the shared admin password, are both worse than a link in the email they
 * already received. So the link carries its own proof.
 *
 * The token is an HMAC of the visit id under the same key that encrypts entry
 * codes. Nothing is stored, so there is no table to keep tidy and no way for a
 * stale row to grant access after the fact. Rotating ACCESS_SECRET_KEY
 * invalidates every outstanding link at once, which is exactly what you want
 * when somebody leaves.
 *
 * The token proves the link came from us. It does not, by itself, open the
 * door: the page behind it still only reveals an entry code on the day of
 * service, and still writes an audit row before showing anything.
 */

function key(): Buffer {
  const raw = process.env.ACCESS_SECRET_KEY;
  if (!raw) throw new Error("ACCESS_SECRET_KEY is not set.");
  return Buffer.from(raw, "base64");
}

/** Domain-separated so a token minted here can never be valid anywhere else. */
function sign(visitId: string): string {
  return createHmac("sha256", key())
    .update(`visit-link:v1:${visitId}`)
    .digest("base64url");
}

export function visitToken(visitId: string): string {
  return sign(visitId);
}

export function visitTokenValid(visitId: string, token: string): boolean {
  let expected: string;
  try {
    expected = sign(visitId);
  } catch {
    return false;
  }
  const a = Buffer.from(expected);
  const b = Buffer.from(token);
  // Compare lengths first, then contents; both operands are our own fixed-width
  // digests, so no secret length is disclosed by the early return.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function visitUrl(baseUrl: string, visitId: string): string {
  return `${baseUrl}/job/${visitId}/${visitToken(visitId)}`;
}
