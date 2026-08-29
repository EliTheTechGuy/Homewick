"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { queryOne } from "@/lib/db";
import { requireAdmin } from "@/lib/admin-auth";
import { stripe } from "@/lib/stripe";
import { sendEmail } from "@/lib/email";
import { saveCardEmail } from "@/lib/emails/templates";
import { formatCents } from "@/lib/money";
import { site } from "@/lib/site";
import { TIMEZONE } from "@/lib/dates";
import type { ServiceType } from "@/lib/pricing";

/**
 * Ask for a card without asking for the money.
 *
 * Stripe calls this setup mode. The customer sees the same checkout page they
 * would for a payment, enters a card, and nothing is charged. What comes back
 * is a card we are allowed to charge later, which is the entire point: the
 * job can be staffed, the customer is not out of pocket for work that has not
 * happened, and we are not relying on an invoice being honoured.
 *
 * A fresh session every time, for the same reason payment links are. Stripe
 * caps a checkout session at 24 hours and will not go longer, so a link made
 * when the booking was created is dead by the time anybody wants it.
 *
 * The permission to charge later is granted by the customer at this step and
 * nowhere else. Stripe records it on the SetupIntent, which comes back marked
 * for off-session use, and the wording on both the checkout page and the
 * email states the amount and the day it moves. Charging a saved card with
 * nobody present rests on that having been said plainly, so it is said twice.
 */

const schema = z.object({ visitId: z.string().uuid() });

type Row = {
  customer_id: string;
  first_name: string;
  email: string;
  amount_cents: number;
  service_type: ServiceType;
  on_date: string;
  line1: string;
  line2: string | null;
  city: string;
  postal_code: string;
  stripe_customer_id: string | null;
  payment_terms: string;
  already_paid: boolean;
};

export async function sendCardLink(
  raw: unknown,
): Promise<{ ok: boolean; message: string }> {
  const admin = await requireAdmin();
  if (!admin) return { ok: false, message: "Not signed in." };

  const parsed = schema.safeParse(raw);
  if (!parsed.success) return { ok: false, message: "That booking could not be found." };
  const { visitId } = parsed.data;

  try {
    const row = await queryOne<Row>(
      `select v.customer_id,
              c.first_name, c.email::text as email,
              (v.base_amount_cents + v.pet_surcharge_cents + v.addons_amount_cents)
                as amount_cents,
              v.service_type,
              (v.scheduled_for at time zone $2)::date::text as on_date,
              p.line1, p.line2, p.city, p.postal_code,
              c.stripe_customer_id,
              v.payment_terms::text as payment_terms,
              (v.stripe_payment_intent_id is not null) as already_paid
         from visits v
         join customers c on c.id = v.customer_id
         join properties p on p.id = v.property_id
        where v.id = $1`,
      [visitId, TIMEZONE],
    );

    if (!row) return { ok: false, message: "That booking could not be found." };
    if (row.already_paid) {
      return { ok: false, message: "That booking has already been paid for." };
    }
    if (row.payment_terms !== "card_on_file") {
      return {
        ok: false,
        message: "That booking is not set up to keep a card. Send a payment link instead.",
      };
    }

    const session = await stripe().checkout.sessions.create({
      mode: "setup",
      currency: "usd",
      // Reuse the Stripe customer when there is one, so somebody booking a
      // second clean is the same person at Stripe rather than a duplicate
      // with its own card.
      customer: row.stripe_customer_id ?? undefined,
      customer_email: row.stripe_customer_id ? undefined : row.email,
      success_url: `${site.url}/book/card-saved?ref=${visitId}`,
      cancel_url: `${site.url}/book/card-saved?ref=${visitId}&canceled=1`,
      metadata: { kind: "card_on_file", visit_id: visitId },
      // Repeated onto the SetupIntent because the session is transient and the
      // intent is what the webhook and any later audit actually read.
      setup_intent_data: {
        metadata: { kind: "card_on_file", visit_id: visitId },
      },
      custom_text: {
        submit: {
          message: `You will not be charged today. Homewick Cleaning will charge ${formatCents(
            row.amount_cents,
          )} to this card on the morning of your clean.`,
        },
      },
    });

    if (!session.url) {
      return { ok: false, message: "Stripe did not return a link. Please try again." };
    }

    const message = saveCardEmail({
      firstName: row.first_name,
      setupUrl: session.url,
      amountCents: row.amount_cents,
      serviceType: row.service_type,
      onDate: row.on_date,
      address: [row.line1, row.line2, `${row.city}, TX ${row.postal_code}`]
        .filter(Boolean)
        .join(", "),
    });

    const { delivered } = await sendEmail({
      to: row.email,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });

    revalidatePath("/admin");
    revalidatePath("/admin/bookings");

    return delivered
      ? { ok: true, message: `Sent to ${row.email}. The link is good for 24 hours.` }
      : {
          ok: false,
          message: "The email did not go. Try again, or send them the link by hand.",
        };
  } catch (err) {
    console.error(`[admin] could not send a card link for visit ${visitId}`, err);
    return { ok: false, message: "That did not go through. Please try again." };
  }
}
