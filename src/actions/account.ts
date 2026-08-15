"use server";

import { cookies, headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { transaction, queryOne, isDatabaseConfigured } from "@/lib/db";
import {
  SESSION_COOKIE,
  consumeLoginToken,
  createLoginLink,
  currentMember,
  endSession,
  sessionCookieOptions,
} from "@/lib/member-auth";
import { sendEmail, signInEmail } from "@/lib/email";
import { claimFreePerk } from "@/lib/membership-lifecycle";
import { memberOverview } from "@/lib/member-account";
import { isStripeConfigured, stripe } from "@/lib/stripe";
import { site } from "@/lib/site";

const emailSchema = z.string().trim().toLowerCase().pipe(z.email());

/**
 * Ask for a sign-in link.
 *
 * The reply never distinguishes a known address from an unknown one. Saying
 * "no account with that email" turns this form into a way to test whether
 * somebody is a customer of a service that visits their home.
 */
export async function requestLoginLink(
  rawEmail: unknown,
): Promise<{ ok: boolean; message: string }> {
  const generic =
    "If that email has an account with us, a sign-in link is on its way. It expires in 15 minutes.";

  const parsed = emailSchema.safeParse(rawEmail);
  if (!parsed.success) {
    return { ok: false, message: "Enter a valid email address." };
  }

  if (!isDatabaseConfigured()) {
    console.error("Sign-in link requested but DATABASE_URL is not set.");
    return { ok: false, message: "Sign-in is unavailable right now. Please try again shortly." };
  }

  const headerList = await headers();
  const ip =
    headerList.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    headerList.get("x-real-ip") ??
    null;

  try {
    const result = await createLoginLink(parsed.data, site.url, ip);

    if (result.sent) {
      const { subject, text } = signInEmail(result.url);
      const { delivered } = await sendEmail({ to: result.email, subject, text });
      if (!delivered) {
        // The link is valid regardless; it is in the server log for an
        // operator to pass on. Do not surface that to the visitor.
        console.warn(`[account] sign-in link for ${result.email} was not emailed.`);
      }
    } else if (result.reason === "rate_limited") {
      console.warn("[account] sign-in link rate limited");
    }

    return { ok: true, message: generic };
  } catch (err) {
    console.error("[account] sign-in link failed", err);
    return { ok: false, message: "Sign-in is unavailable right now. Please try again shortly." };
  }
}

/**
 * Complete sign in from an emailed link.
 *
 * Only ever runs on a submit, never on a page load. Consuming the token on a
 * GET meant Outlook's Safe Links scanner spent it while checking the message,
 * and the member was told a link they had just been sent had expired.
 */
export async function completeSignIn(
  token: unknown,
): Promise<{ ok: boolean; message: string }> {
  const parsed = z.string().trim().min(1).safeParse(token);
  if (!parsed.success) {
    return { ok: false, message: "That link is incomplete. Ask for a fresh one." };
  }

  try {
    const sessionToken = await consumeLoginToken(parsed.data);
    if (!sessionToken) {
      return {
        ok: false,
        message:
          "Links last 15 minutes and work once. Ask for a new one and it will sign you straight in.",
      };
    }

    (await cookies()).set(SESSION_COOKIE, sessionToken, sessionCookieOptions());
    revalidatePath("/account");
    return { ok: true, message: "Signed in." };
  } catch (err) {
    console.error("[account] completing sign in failed", err);
    return { ok: false, message: "Sign in is unavailable right now. Please try again." };
  }
}

export async function signOut(): Promise<void> {
  await endSession();
  revalidatePath("/account");
}

/**
 * Claim this period's free add-on.
 *
 * The heavy lifting is claimFreePerk, which locks the period row, two taps in
 * quick succession must not hand out two free ovens.
 */
export async function chooseFreeAddOn(
  addOnCode: unknown,
): Promise<{ ok: boolean; message: string }> {
  const member = await currentMember();
  if (!member) return { ok: false, message: "Please sign in again." };

  const code = z.string().trim().min(1).safeParse(addOnCode);
  if (!code.success) return { ok: false, message: "Choose an add-on." };

  const overview = await memberOverview(member.customerId);
  if (!overview.currentPeriod) {
    return { ok: false, message: "You do not have an active membership period." };
  }
  if (overview.currentPeriod.freeAddOnUsed) {
    return { ok: false, message: "This month's free add-on has already been chosen." };
  }
  if (!overview.claimableVisitId) {
    return {
      ok: false,
      message:
        "There is no upcoming cleaning left this month to add it to. It will be available again next month.",
    };
  }

  const addOn = await queryOne<{ id: string; name: string; free_perk_eligible: boolean }>(
    `select id, name, free_perk_eligible from add_ons where code = $1 and is_active`,
    [code.data],
  );
  if (!addOn) return { ok: false, message: "That add-on is not available." };
  if (!addOn.free_perk_eligible) {
    return { ok: false, message: "That add-on is not eligible as the free monthly perk." };
  }

  try {
    const result = await transaction((client) =>
      claimFreePerk(
        client,
        overview.currentPeriod!.id,
        overview.claimableVisitId!,
        addOn.id,
      ),
    );

    if (!result.claimed) {
      return {
        ok: false,
        message:
          result.reason === "already_claimed"
            ? "This month's free add-on has already been chosen."
            : "That add-on could not be added.",
      };
    }

    revalidatePath("/account");
    return { ok: true, message: `${addOn.name} is booked for your next clean, free.` };
  } catch (err) {
    console.error("[account] free add-on claim failed", err);
    return { ok: false, message: "That did not go through. Please try again." };
  }
}

/**
 * Hand the member to Stripe for card details and invoices.
 *
 * Cancellation is deliberately not offered here. Stripe's portal would end the
 * subscription immediately, which walks straight past the 14 days' notice in
 * the service agreement and the end date computed from it. Cancelling goes
 * through us.
 */
export async function openBillingPortal(): Promise<{ url: string } | { error: string }> {
  const member = await currentMember();
  if (!member) return { error: "Please sign in again." };

  if (!isStripeConfigured()) {
    console.error("[account] billing portal requested but STRIPE_SECRET_KEY is not set.");
    return { error: "Billing is unavailable right now. Please try again shortly." };
  }

  const customer = await queryOne<{ stripe_customer_id: string | null }>(
    `select stripe_customer_id from customers where id = $1`,
    [member.customerId],
  );

  if (!customer?.stripe_customer_id) {
    return {
      error:
        "We do not have a card on file yet. Once your first payment goes through, you can manage it here.",
    };
  }

  try {
    const session = await stripe().billingPortal.sessions.create({
      customer: customer.stripe_customer_id,
      return_url: `${site.url}/account`,
    });
    return { url: session.url };
  } catch (err) {
    console.error("[account] billing portal failed", err);
    return { error: "We could not open billing just now. Please try again." };
  }
}
