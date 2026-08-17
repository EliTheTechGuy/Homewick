"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  ADMIN_COOKIE,
  adminCookieOptions,
  consumeAdminLoginToken,
  createAdminLoginLink,
  endAdminSession,
} from "@/lib/admin-auth";
import { sendEmail } from "@/lib/email";
import { site } from "@/lib/site";
import { throttleFailure } from "@/lib/admin-throttle";

/**
 * Ask for a sign-in link.
 *
 * The reply is identical whether the address exists or not. Admin is a much
 * smaller set than the member list, so confirming one is a stronger hint than
 * it would be there.
 */
export async function requestAdminLink(
  formData: FormData,
): Promise<{ ok: boolean; message: string }> {
  const generic =
    "If that address can sign in, a link is on its way. It expires in 15 minutes.";

  const parsed = z
    .string()
    .trim()
    .max(200)
    .pipe(z.email())
    .safeParse(formData.get("email"));
  if (!parsed.success) return { ok: false, message: "Enter a valid email address." };

  const headerList = await headers();
  const ip =
    headerList.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    headerList.get("x-real-ip") ??
    "unknown";

  try {
    const result = await createAdminLoginLink(parsed.data, adminBaseUrl(headerList), ip);

    if (result.sent) {
      // Not awaited, so a known address does not take measurably longer than
      // an unknown one and give itself away by timing.
      void sendEmail({
        to: result.email,
        subject: "Your Homewick admin sign-in link",
        text:
          `Hi ${result.name},\n\n` +
          `Open this to sign in to Homewick admin. It expires in 15 minutes and ` +
          `works once.\n\n${result.url}\n\n` +
          `If you did not ask for this, somebody has your email address and ` +
          `nothing more. The link alone does not let them in.\n`,
      }).catch((err) => console.error("[admin] sign-in link not sent", err));
    } else {
      // A request for an address that cannot sign in is worth slowing, since
      // it is what walking a list of addresses looks like.
      await throttleFailure(ip);
    }

    return { ok: true, message: generic };
  } catch (err) {
    console.error("[admin] sign-in link failed", err);
    return { ok: false, message: "Sign-in is unavailable right now." };
  }
}

/** Spend the link. Called from a click, never from the page loading. */
export async function completeAdminSignIn(token: unknown): Promise<{ error: string } | never> {
  const parsed = z.string().min(10).max(200).safeParse(token);
  if (!parsed.success) return { error: "That link is not valid." };

  const session = await consumeAdminLoginToken(parsed.data);
  if (!session) {
    return { error: "That link has expired or has already been used." };
  }

  (await cookies()).set(ADMIN_COOKIE, session, adminCookieOptions());
  redirect("/admin");
}

export async function signOutAdmin(): Promise<never> {
  await endAdminSession();
  redirect("/admin/sign-in");
}

/**
 * The host the link should point at.
 *
 * Taken from the request rather than from site.url, because admin lives on its
 * own hostname and a link back to the public site would land on a 404.
 */
function adminBaseUrl(headerList: Headers): string {
  const host = headerList.get("host");
  if (!host) return site.url;
  const protocol = host.startsWith("localhost") ? "http" : "https";
  return `${protocol}://${host}`;
}
