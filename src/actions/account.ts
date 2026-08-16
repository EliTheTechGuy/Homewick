"use server";

import { cookies, headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { transaction, query, queryOne, isDatabaseConfigured } from "@/lib/db";
import {
  SESSION_COOKIE,
  consumeLoginToken,
  createLoginLink,
  currentMember,
  endSession,
  sessionCookieOptions,
} from "@/lib/member-auth";
import { sendEmail, signInEmail } from "@/lib/email";
import { claimFreePerk, requestCancellation } from "@/lib/membership-lifecycle";
import { TIMEZONE, formatLong } from "@/lib/dates";
import { sendOnce } from "@/lib/emails/send-once";
import { cancellationConfirmedEmail } from "@/lib/emails/templates";
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

      // Recorded like every other email, so "I never got my link" is a
      // question with an answer. Keyed on the token row rather than the
      // customer, because asking twice must send twice and each request needs
      // its own line rather than colliding with the last one.
      //
      // Written after the attempt, not before, so the row carries whether it
      // actually went. A failure here must not swallow a link that was sent.
      await query(
        `insert into email_deliveries (event_key, kind, customer_id, recipient, delivered)
         values ($1, 'member_sign_in', $2, $3, $4)
         on conflict (event_key, kind) do nothing`,
        [`login:${result.tokenId}`, result.customerId, result.email, delivered],
      ).catch((err) => console.error("[account] could not record sign-in email", err));

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
 * Cancel a membership, with the notice period the service agreement promises.
 *
 * Three things have to happen together, and missing any one of them causes a
 * different kind of complaint:
 *
 *   - Our own state moves to pending_cancellation with a computed end date,
 *     and visits beyond that date are dropped.
 *   - Stripe is told to stop billing on the same date. Without this the
 *     member keeps being charged for a service that has ended, which is the
 *     worst failure available here.
 *   - The member gets the end date in writing, so a cleaning that is still
 *     coming is not mistaken for a cancellation that failed.
 */
export async function cancelMembership(): Promise<{ ok: boolean; message: string }> {
  const member = await currentMember();
  if (!member) return { ok: false, message: "Please sign in again." };

  try {
    const result = await transaction(async (client) => {
      const { rows } = await client.query<{
        id: string;
        status: string;
        stripe_subscription_id: string | null;
      }>(
        `select id, status::text as status, stripe_subscription_id
           from subscriptions
          where customer_id = $1 and status in ('active', 'paused')
          order by created_at desc
          limit 1`,
        [member.customerId],
      );

      const sub = rows[0];
      if (!sub) return null;

      const { endsOn } = await requestCancellation(client, sub.id);

      const remaining = await client.query<{ on_date: string }>(
        `select (scheduled_for at time zone $2)::date::text as on_date
           from visits
          where subscription_id = $1 and status = 'scheduled'
            and scheduled_for >= now()
          order by scheduled_for`,
        [sub.id, TIMEZONE],
      );

      // The instant service ends, in local terms, for Stripe.
      const boundary = await client.query<{ epoch: string }>(
        `select extract(epoch from ($1::date at time zone $2))::bigint::text as epoch`,
        [endsOn, TIMEZONE],
      );

      return {
        subscriptionId: sub.id,
        stripeSubscriptionId: sub.stripe_subscription_id,
        endsOn,
        remaining: remaining.rows.map((r) => r.on_date),
        endsAtEpoch: Number(boundary.rows[0].epoch),
      };
    });

    if (!result) {
      return { ok: false, message: "You do not have a membership to cancel." };
    }

    // Stripe stops billing on the same date the service stops. Doing this
    // outside the transaction keeps a Stripe outage from rolling back a
    // cancellation the member has already been told about.
    if (result.stripeSubscriptionId && isStripeConfigured()) {
      try {
        const nowEpoch = Math.floor(Date.now() / 1000);
        await stripe().subscriptions.update(result.stripeSubscriptionId,
          result.endsAtEpoch > nowEpoch
            ? { cancel_at: result.endsAtEpoch }
            : { cancel_at_period_end: true },
        );
      } catch (err) {
        // Loud, because the member is now cancelled with us while Stripe may
        // still bill them. That needs a human before the next invoice.
        console.error(
          `[billing] URGENT: subscription ${result.subscriptionId} cancelled in our ` +
            `records but Stripe was not updated. It may keep charging.`,
          err,
        );
      }
    }

    try {
      await sendOnce({
        eventKey: `cancel:${result.subscriptionId}`,
        kind: "cancellation_confirmed",
        to: member.email,
        customerId: member.customerId,
        message: cancellationConfirmedEmail({
          firstName: member.firstName,
          endsOn: result.endsOn,
          remainingVisits: result.remaining,
        }),
      });
    } catch (err) {
      console.error("[email] cancellation confirmation failed", err);
    }

    revalidatePath("/account");
    return {
      ok: true,
      message: `Your membership will end on ${formatLong(result.endsOn)}. We have emailed you the details.`,
    };
  } catch (err) {
    console.error("[account] cancellation failed", err);
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
