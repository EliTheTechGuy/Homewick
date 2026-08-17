"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  ADMIN_COOKIE,
  adminCookieOptions,
  endAdminSession,
  signInWithPassword,
} from "@/lib/admin-auth";
import { throttleFailure, clearFailures } from "@/lib/admin-throttle";

/**
 * Sign in with an email and password.
 *
 * One message for every kind of failure. Distinguishing "no such account" from
 * "wrong password" would confirm which addresses reach admin, and that list is
 * short enough to be worth guessing at.
 *
 * There is no reset by email on purpose. Adding one would mean whoever takes
 * the mailbox takes admin, which is the thing choosing a password was meant to
 * avoid. Recovery is `npm run admin:password`, run by somebody who already
 * holds the database credentials.
 */
export async function signInAdmin(
  formData: FormData,
): Promise<{ error: string } | never> {
  const email = z.string().trim().max(200).safeParse(formData.get("email"));
  const password = z.string().min(1).max(400).safeParse(formData.get("password"));

  if (!email.success || !password.success) {
    return { error: "Enter your email and password." };
  }

  const headerList = await headers();
  const ip =
    headerList.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    headerList.get("x-real-ip") ??
    "unknown";

  let session: string | null = null;
  try {
    session = await signInWithPassword(email.data, password.data);
  } catch (err) {
    console.error("[admin] sign-in failed", err);
    return { error: "Sign-in is unavailable right now. Please try again shortly." };
  }

  if (!session) {
    // Recorded and slowed. With no second factor and no email recovery, a
    // leaked or guessed password is the whole game, so making attempts cost
    // time is the main thing standing in the way of working through a list.
    await throttleFailure(ip);
    return { error: "That email and password do not match." };
  }

  await clearFailures(ip);
  (await cookies()).set(ADMIN_COOKIE, session, adminCookieOptions());
  redirect("/admin");
}

export async function signOutAdmin(): Promise<never> {
  await endAdminSession();
  redirect("/admin/sign-in");
}
