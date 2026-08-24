"use server";

import { revalidatePath } from "next/cache";
import { transaction } from "@/lib/db";
import { currentMember } from "@/lib/member-auth";
import { requireAdmin } from "@/lib/admin-auth";
import { isStripeConfigured, stripe } from "@/lib/stripe";
import { alertOwner } from "@/lib/alert";
import { formatCents } from "@/lib/money";
import { cancellationFor } from "@/lib/cancellation";
import { sendOnce } from "@/lib/emails/send-once";
import { visitCanceledEmail } from "@/lib/emails/templates";
import type { ServiceType } from "@/lib/pricing";

/**
 * Call off a one-time clean and give the money back.
 *
 * Only one-time visits. A membership visit is not a purchase: it is one of the
 * cleanings a period already paid for, and dropping it does not owe anybody a
 * refund. Members move a visit inside their period or cancel the membership,
 * and both of those already exist.
 *
 * The order here is deliberate and is the whole difficulty of the thing.
 *
 * The database is settled first, inside a transaction that locks the row, so
 * two clicks cannot both decide they are the one cancelling. Then Stripe is
 * asked for the refund. If Stripe fails, the visit is already cancelled and
 * the customer has already been told it is cancelled, which is the right way
 * round: a cleaner must not be dispatched to a job somebody called off, and a
 * refund that has not landed is a problem you can fix by hand. The reverse,
 * refunding money for a visit still on the schedule, sends somebody to a house
 * that is not expecting them.
 *
 * A failed refund therefore pages the owner rather than only logging, because
 * money owed to a customer that nobody knows about becomes a chargeback.
 */

type Result = { ok: boolean; message: string };

type VisitRow = {
  id: string;
  customer_id: string;
  origin: string;
  status: string;
  service_type: ServiceType;
  scheduled_for: Date;
  on_date: string;
  paid_cents: number;
  stripe_payment_intent_id: string | null;
  stripe_refund_id: string | null;
  first_name: string;
  email: string;
};

const SELECT_FOR_CANCEL = `
  select v.id, v.customer_id, v.origin::text as origin, v.status::text as status,
         v.service_type, v.scheduled_for,
         (v.scheduled_for at time zone 'America/Chicago')::date::text as on_date,
         (v.base_amount_cents + v.pet_surcharge_cents + v.addons_amount_cents)
           as paid_cents,
         v.stripe_payment_intent_id, v.stripe_refund_id,
         c.first_name, c.email::text as email
    from visits v
    join customers c on c.id = v.customer_id
   where v.id = $1
   for update of v`;

/** The member cancelling their own booking from their account. */
export async function cancelMyVisit(visitId: unknown): Promise<Result> {
  const member = await currentMember();
  if (!member) return { ok: false, message: "Please sign in again." };
  if (typeof visitId !== "string") return { ok: false, message: "That booking could not be found." };

  return cancel(visitId, { customerId: member.customerId, actor: "customer" });
}

/** Admin cancelling on somebody's behalf, usually because they phoned. */
export async function cancelVisitAsAdmin(visitId: unknown): Promise<Result> {
  const admin = await requireAdmin();
  if (!admin) return { ok: false, message: "Not signed in." };
  if (typeof visitId !== "string") return { ok: false, message: "That booking could not be found." };

  return cancel(visitId, { customerId: null, actor: "admin" });
}

async function cancel(
  visitId: string,
  by: { customerId: string | null; actor: "customer" | "admin" },
): Promise<Result> {
  try {
    const outcome = await transaction(async (client) => {
      const { rows } = await client.query<VisitRow>(SELECT_FOR_CANCEL, [visitId]);
      const visit = rows[0];

      if (!visit) return { kind: "error" as const, message: "That booking could not be found." };

      // Scoped to the signed-in customer. Without this, a member could cancel
      // somebody else's booking by guessing an id.
      if (by.customerId && visit.customer_id !== by.customerId) {
        return { kind: "error" as const, message: "That booking could not be found." };
      }

      if (visit.origin !== "one_off") {
        return {
          kind: "error" as const,
          message:
            "That cleaning is part of a membership. Move it to another day from your account, or cancel the membership itself.",
        };
      }

      if (visit.status === "canceled") {
        return { kind: "error" as const, message: "That booking is already cancelled." };
      }
      if (visit.status === "completed") {
        return {
          kind: "error" as const,
          message:
            "That cleaning has already happened. If something was wrong with it, tell us within 48 hours and we will come back.",
        };
      }

      const money = cancellationFor({
        paidCents: visit.paid_cents,
        scheduledFor: visit.scheduled_for,
        now: new Date(),
      });

      await client.query(
        `update visits
            set status = 'canceled',
                canceled_at = now(),
                cancellation_fee_cents = $2
          where id = $1`,
        [visit.id, money.feeCents],
      );

      return { kind: "ok" as const, visit, money };
    });

    if (outcome.kind === "error") return { ok: false, message: outcome.message };
    const { visit, money } = outcome;

    let refunded = money.refundCents === 0;
    if (money.refundCents > 0 && visit.stripe_payment_intent_id && isStripeConfigured()) {
      // Already refunded once means this is a retry, and Stripe would happily
      // issue a second one. The column is the lock.
      if (visit.stripe_refund_id) {
        refunded = true;
      } else {
        try {
          const refund = await stripe().refunds.create({
            payment_intent: visit.stripe_payment_intent_id,
            amount: money.refundCents,
            reason: "requested_by_customer",
          });
          await transaction((client) =>
            client.query(`update visits set stripe_refund_id = $2 where id = $1`, [
              visit.id,
              refund.id,
            ]),
          );
          refunded = true;
        } catch (err) {
          console.error(`[billing] refund failed for visit ${visit.id}`, err);
          await alertOwner(
            "A cancellation refund did not go through",
            `A booking was cancelled and the customer has been told they are owed ` +
              `${formatCents(money.refundCents)}, but Stripe refused the refund.\n\n` +
              `Visit: ${visit.id}\n` +
              `Customer: ${visit.email}\n` +
              `Payment: ${visit.stripe_payment_intent_id}\n\n` +
              `Refund it in the Stripe dashboard. The visit is already off the ` +
              `schedule, so nobody is being sent out. This is only the money.`,
          );
        }
      }
    }

    await sendOnce({
      eventKey: `visit_canceled:${visit.id}`,
      kind: "visit_canceled",
      to: visit.email,
      customerId: visit.customer_id,
      message: visitCanceledEmail({
        firstName: visit.first_name,
        serviceType: visit.service_type,
        onDate: visit.on_date,
        refundCents: money.refundCents,
        feeCents: money.feeCents,
        tier: money.tier,
      }),
    }).catch((err) => {
      console.error(`[email] cancellation notice failed for visit ${visit.id}`, err);
      return { sent: false as const };
    });

    revalidatePath("/account");
    revalidatePath("/admin");

    const refundLine =
      money.refundCents === 0
        ? "There is nothing to refund."
        : refunded
          ? `${formatCents(money.refundCents)} is on its way back, and takes a few days to reach the card.`
          : `${formatCents(money.refundCents)} is owed back and we are sorting it out.`;

    const feeLine =
      money.tier === "half"
        ? ` Half the price, ${formatCents(money.feeCents)}, is kept because it was inside 48 hours.`
        : money.tier === "full"
          ? ` It was inside 24 hours, so the full ${formatCents(money.feeCents)} is kept.`
          : "";

    return { ok: true, message: `That cleaning is cancelled. ${refundLine}${feeLine}` };
  } catch (err) {
    console.error(`[cancel] visit ${visitId} could not be cancelled`, err);
    return { ok: false, message: "That did not go through. Please try again." };
  }
}
