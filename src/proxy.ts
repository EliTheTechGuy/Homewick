import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_COOKIE } from "@/lib/admin-auth";

/**
 * Where admin lives, and who gets in.
 *
 * Two separate jobs, both settled before a page renders.
 *
 * Admin belongs on its own hostname. That is not a security measure by itself:
 * a secret URL stops nobody who has seen a link, a browser history, or a
 * referrer header. What it buys is separation. The admin session cookie is
 * scoped to that host, so a bug on the public site cannot reach it, and the
 * public site never serves an admin route at all.
 *
 * The gate is now a signed-in session rather than one shared password. That
 * password could not be revoked for a single person, recorded nobody's
 * identity, and left the entry-code audit log holding whatever name the
 * browser chose to send.
 *
 * Only the presence of a session cookie is checked here. Whether it is valid
 * is settled by the page, which can reach the database; this runs on every
 * matching request and should not. A forged cookie therefore gets past this
 * point and is turned away a few milliseconds later, having learned nothing.
 */

/** Admin answers here. Anything else serving /admin is a mistake. */
function isAdminHost(host: string | null): boolean {
  if (!host) return false;
  const name = host.split(":")[0].toLowerCase();
  return (
    name.startsWith("admin.") ||
    // Development has no subdomains, so admin shares the origin there.
    name === "localhost" ||
    name === "127.0.0.1"
  );
}

/** Where the public site lives, for sending stray requests back to it. */
const PUBLIC_ORIGIN =
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.homewickcleaning.net";

function isLocal(host: string | null): boolean {
  const name = host?.split(":")[0].toLowerCase();
  return name === "localhost" || name === "127.0.0.1";
}

/** Reachable while signed out, or nobody could ever sign in. */
function isPublicAdminPath(pathname: string): boolean {
  return pathname === "/admin/sign-in";
}

export default async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const host = request.headers.get("host");
  const onAdminHost = isAdminHost(host);
  const isAdminPath = pathname === "/admin" || pathname.startsWith("/admin/");

  // Development has no subdomains, so localhost has to serve both sites at
  // once. Only admin paths are gated there. Without this the public site is
  // unreachable locally without an admin cookie, which is how it shipped: the
  // rules below all key off "is this the admin host", and locally that is
  // true for every request, including /pricing.
  if (isLocal(host) && !isAdminPath) return NextResponse.next();

  // Typing the admin address should land in admin. Anything else is a small
  // daily annoyance: nobody visits this hostname to read about pricing.
  if (onAdminHost && pathname === "/") {
    return NextResponse.redirect(new URL("/admin", request.url));
  }

  // Every other public page still answered on the admin host, which meant two
  // live copies of the site. /book was the one that mattered: a booking begun
  // here would have been handed to Stripe and returned to the public origin
  // partway through, because the success and cancel URLs are built from the
  // configured site address rather than from whichever host somebody is on.
  //
  // Localhost has already returned above, so this only ever runs for real.
  if (onAdminHost && !isAdminPath) {
    const target = new URL(pathname + request.nextUrl.search, PUBLIC_ORIGIN);
    return NextResponse.redirect(target, 308);
  }

  // On the public site, admin does not exist. Deliberately a 404 rather than a
  // redirect, because a redirect would confirm there is something to find.
  if (!onAdminHost && isAdminPath) {
    return new NextResponse("Not found", {
      status: 404,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }

  // Everything else on the public host is the public site, untouched.
  if (!onAdminHost) return NextResponse.next();

  if (isPublicAdminPath(pathname)) return NextResponse.next();

  if (!request.cookies.get(ADMIN_COOKIE)?.value) {
    return NextResponse.redirect(new URL("/admin/sign-in", request.url));
  }

  return NextResponse.next();
}

export const config = {
  // Everything except Next's own assets, Vercel's own endpoints, files with an
  // extension, and the API.
  //
  // The API is excluded on purpose: Stripe posts to the public origin, and a
  // redirect on a POST is a good way to lose a webhook body. /_vercel is
  // excluded for the same reason, since analytics beacons are POSTs too.
  matcher: ["/((?!_next/|_vercel/|api/|.*\\.).*)"],
};
