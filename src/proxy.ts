import { NextResponse, type NextRequest } from "next/server";
import { throttleFailure, clearFailures } from "@/lib/admin-throttle";

/**
 * Make the browser ask for the admin password.
 *
 * The admin pages already check HTTP Basic credentials, but nothing ever sent
 * back the challenge that makes a browser show its password box. Without it
 * the only way to supply credentials is to put them in the URL, and both
 * mobile Safari and Chrome strip that. So the one screen you need while
 * standing at a customer's door, the one holding the entry codes, could not be
 * opened on the device you would be holding.
 *
 * This runs before the page, so an unauthenticated request never reaches the
 * database. The check inside the page stays as it is: middleware is easy to
 * misconfigure with a matcher typo, and a door code is not something to
 * protect with exactly one gate.
 */

const REALM = 'Basic realm="Homewick admin", charset="UTF-8"';

function challenge(): NextResponse {
  return new NextResponse("Authentication required.", {
    status: 401,
    headers: {
      "WWW-Authenticate": REALM,
      // A 401 body is attacker-visible, so it says nothing about why.
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

/**
 * Compare by digest rather than byte by byte.
 *
 * Hashing first means the comparison runs over two fixed-length values, so
 * neither the length of the real password nor the position of the first wrong
 * character can be inferred from how long the answer takes.
 */
async function matches(candidate: string, expected: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(candidate)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const x = new Uint8Array(a);
  const y = new Uint8Array(b);
  let mismatch = 0;
  for (let i = 0; i < x.length; i++) mismatch |= x[i] ^ y[i];
  return mismatch === 0;
}

export default async function proxy(request: NextRequest) {
  const expected = process.env.ADMIN_PASSWORD;

  // No password configured means the gate cannot be enforced, so refuse
  // rather than challenge. Challenging would invite guessing at a lock that
  // is not attached to anything.
  if (!expected) {
    console.error("[admin] ADMIN_PASSWORD is not set; refusing all admin requests.");
    return new NextResponse("Unavailable.", {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }

  const header = request.headers.get("authorization");
  if (!header?.startsWith("Basic ")) return challenge();

  let decoded: string;
  try {
    decoded = atob(header.slice(6));
  } catch {
    return challenge();
  }

  const separator = decoded.indexOf(":");
  if (separator === -1) return challenge();

  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "unknown";

  if (!(await matches(decoded.slice(separator + 1), expected))) {
    // Recorded and slowed, not merely logged. One shared password that opens
    // every customer's door codes, with nothing counting the misses, could be
    // guessed at full speed indefinitely and leave no trace of having been
    // tried. Deliberately not a lockout: that would let a stranger shut the
    // owner out of their own business on a working morning.
    await throttleFailure(ip);
    return challenge();
  }

  // A correct password clears the slate, so one bad morning does not leave
  // somebody throttled for the rest of the window.
  await clearFailures(ip);
  return NextResponse.next();
}

export const config = {
  matcher: ["/admin", "/admin/:path*"],
};
