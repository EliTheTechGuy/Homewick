"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { queryOne, query } from "@/lib/db";
import { requireAdmin } from "@/lib/admin-auth";
import { stripe } from "@/lib/stripe";
import { formatCents } from "@/lib/money";

/**
 * Take the money on a card we were given earlier.
 *
 * Deliberately a button and not a scheduled job. A charge that fails does so
 * with nobody watching, and the morning of a clean is exactly when somebody
 * needs to know: there is still time to call her, and there is still time to
 * decide whether to send the crew. A cron job would discover the same failure
 * and tell nobody until the work was already done.
 *
 * Separate from marking the job complete, on purpose. The money is taken in
 * the morning and the job is finished in the afternoon, so tying them together
 * would either charge too late or mark work done that has not started.
 *
 * On the duplicate charge: the button confirms, disables itself while the
 * request is in flight, and this refuses outright once a payment intent is
 * recorded. That leaves a sub-second window where two confirmed presses could
 * both pass the check. No Stripe idempotency key is used to close it, because
 * a key would also cache a decline for 24 hours, and a customer who rings her
 * bank and asks us to try again is a likelier Saturday than a double click.
 */

const schema = z.object({ visitId: z.string().uuid() });

type Row = {
  email: string;
  first_name: string;
  amount_cents: number;
  stripe_customer_id: string | null;
  stripe_payment_method_id: string | null;
  already_paid: boolean;
  card_saved: boolean;
};

export async function chargeSavedCard(
  raw: unknown,
): Promise<{ ok: boolean; message: string }> {
  const admin = await requireAdmin();
  if (!admin) return { ok: false, message: "Not signed in." };

  const parsed = schema.safeParse(raw);
  if (!parsed.success) return { ok: false, message: "That booking could not be found." };
  const { visitId } = parsed.data;

  const row = await queryOne<Row>(
    `select c.email::text as email, c.first_name,
            (v.base_amount_cents + v.pet_surcharge_cents + v.addons_amount_cents)
              as amount_cents,
            c.stripe_customer_id, c.stripe_payment_method_id,
            (v.stripe_payment_intent_id is not null) as already_paid,
            (v.card_saved_at is not null) as card_saved
       from visits v
       join customers c on c.id = v.customer_id
      where v.id = $1`,
    [visitId],
  );

  if (!row) return { ok: false, message: "That booking could not be found." };
  if (row.already_paid) {
    return { ok: false, message: "That booking has already been paid for." };
  }
  if (!row.card_saved || !row.stripe_payment_method_id || !row.stripe_customer_id) {
    return {
      ok: false,
      message: "There is no card on file yet. Send the card link and wait for them to save one.",
    };
  }
  if (row.amount_cents <= 0) {
    return { ok: false, message: "This booking has no price on it to charge." };
  }

  try {
    const intent = await stripe().paymentIntents.create({
      amount: row.amount_cents,
      currency: "usd",
      customer: row.stripe_customer_id,
      payment_method: row.stripe_payment_method_id,
      // Nobody is at the keyboard. This is what tells Stripe to lean on the
      // permission given when the card was saved rather than expecting the
      // customer to be there to approve it.
      off_session: true,
      confirm: true,
      // Stripe emails this the moment the charge lands. A charge that arrives
      // days after the card was entered is the kind a customer forgets and
      // disputes, and a receipt with our name on it is the cheapest defence
      // against that there is.
      receipt_email: row.email,
      description: "Homewick Cleaning, one-time visit",
      metadata: { kind: "one_time", visit_id: visitId },
    });

    if (intent.status !== "succeeded") {
      // Anything short of succeeded is not money. requires_action is the one
      // that actually happens here: the bank wants the cardholder to approve
      // it, and off-session there is nobody to do that.
      return {
        ok: false,
        message:
          intent.status === "requires_action"
            ? "Her bank wants her to approve this one. Send a payment link instead so she can confirm it herself."
            : `Stripe left the payment as ${intent.status}. Nothing has been taken.`,
      };
    }

    await query(
      `update visits
          set stripe_payment_intent_id = $2
        where id = $1 and stripe_payment_intent_id is null`,
      [visitId, intent.id],
    );

    revalidatePath("/admin");
    revalidatePath("/admin/bookings");

    return {
      ok: true,
      message: `Charged ${formatCents(row.amount_cents)}. ${row.first_name} has a receipt.`,
    };
  } catch (err) {
    // A declined card arrives here as an exception rather than a status, and
    // the reason is the useful part: "insufficient funds" is a different phone
    // call from "card expired".
    //
    // Only a card error's own message is worth repeating, though. Anything
    // else is Stripe talking to a developer, and "The provided PaymentMethod
    // cannot be attached" told an operator standing outside a house precisely
    // nothing about what to do next.
    const isCardError =
      err && typeof err === "object" && (err as { type?: unknown }).type === "StripeCardError";
    const reason = isCardError
      ? String((err as { message: unknown }).message)
      : "The card on file could not be used. Send the card link again so they can re-enter it.";
    console.error(`[admin] charge failed for visit ${visitId}`, err);
    return { ok: false, message: `Nothing was taken. ${reason}` };
  }
}
