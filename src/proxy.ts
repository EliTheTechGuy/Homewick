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

/** Reachable while signed out, or nobody could ever sign in. */
function isPublicAdminPath(pathname: string): boolean {
  return pathname === "/admin/sign-in" || pathname === "/admin/verify";
}

export default async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // On the public site, admin does not exist. Deliberately a 404 rather than a
  // redirect, because a redirect would confirm there is something to find.
  if (!isAdminHost(request.headers.get("host"))) {
    return new NextResponse("Not found", {
      status: 404,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }

  if (isPublicAdminPath(pathname)) return NextResponse.next();

  if (!request.cookies.get(ADMIN_COOKIE)?.value) {
    return NextResponse.redirect(new URL("/admin/sign-in", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin", "/admin/:path*"],
};
