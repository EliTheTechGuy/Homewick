import { NextResponse } from "next/server";
import { consumeLoginToken, SESSION_COOKIE, sessionCookieOptions } from "@/lib/member-auth";
import { site } from "@/lib/site";

/**
 * The target of the emailed sign-in link.
 *
 * A route handler rather than a page so the session cookie is set on a real
 * response, and so the token never survives in the address bar — the redirect
 * drops it immediately, keeping it out of browser history and out of any
 * referrer sent by the account page.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token") ?? "";

  const sessionToken = await consumeLoginToken(token).catch((err) => {
    console.error("[account] verify failed", err);
    return null;
  });

  if (!sessionToken) {
    return NextResponse.redirect(new URL("/account?expired=1", site.url));
  }

  const response = NextResponse.redirect(new URL("/account", site.url));
  response.cookies.set(SESSION_COOKIE, sessionToken, sessionCookieOptions());
  return response;
}
