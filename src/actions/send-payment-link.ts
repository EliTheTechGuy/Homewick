"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { queryOne } from "@/lib/db";
import { requireAdmin } from "@/lib/admin-auth";
import { sendEmail } from "@/lib/email";
import { paymentLinkEmail } from "@/lib/emails/templates";
import { createCheckoutSession } from "./checkout";
import type { ServiceType } from "@/lib/pricing";

/**
 * Ask a customer for the money, when you decide to.
 *
 * The counterpart to agreeing a job before collecting for it. The booking is
 * already on the board and staffed; this is the part where somebody is asked
 * to pay for it.
 *
 * A fresh Checkout Session every time, deliberately. Stripe caps a session at
 * 24 hours and will not go longer, so any link made when the booking was
 * created is dead by the time it is wanted. Reusing one would send a customer
 * to an expired page and look like a broken business.
 *
 * Not sendOnce. That exists to stop a webhook firing the same message twice,
 * and this is a button somebody presses on purpose: pressing it again because
 * the customer says it never arrived has to send it again.
 */

const schema = z.object({
  kind: z.enum(["membership", "one_time"]),
  id: z.string().uuid(),
});

type Row = {
  first_name: string;
  email: string;
  amount_cents: number;
  service_type: ServiceType;
  starts_on: string;
  interval_days: number | null;
  line1: string;
  line2: string | null;
  city: string;
  postal_code: string;
};

export async function sendPaymentLink(
  raw: unknown,
): Promise<{ ok: boolean; message: string }> {
  const admin = await requireAdmin();
  if (!admin) return { ok: false, message: "Not signed in." };

  const parsed = schema.safeParse(raw);
  if (!parsed.success) return { ok: false, message: "That booking could not be found." };
  const { kind, id } = parsed.data;

  try {
    const row =
      kind === "membership"
        ? await queryOne<Row>(
            `select c.first_name, c.email::text as email,
                    s.monthly_amount_cents as amount_cents,
                    'standard'::service_type as service_type,
                    s.started_on::text as starts_on, s.interval_days,
                    p.line1, p.line2, p.city, p.postal_code
               from subscriptions s
               join customers c on c.id = s.customer_id
               join properties p on p.id = s.property_id
              where s.id = $1 and s.status = 'pending_payment'`,
            [id],
          )
        : await queryOne<Row>(
            `select c.first_name, c.email::text as email,
                    (v.base_amount_cents + v.pet_surcharge_cents + v.addons_amount_cents)
                      as amount_cents,
                    v.service_type,
                    (v.scheduled_for at time zone 'America/Chicago')::date::text as starts_on,
                    null::int as interval_days,
                    p.line1, p.line2, p.city, p.postal_code
               from visits v
               join customers c on c.id = v.customer_id
               join properties p on p.id = v.property_id
              where v.id = $1 and v.stripe_payment_intent_id is null`,
            [id],
          );

    if (!row) {
      return {
        ok: false,
        message: "That booking is either already paid for or could not be found.",
      };
    }

    const session = await createCheckoutSession(id, kind);
    if ("error" in session) {
      return { ok: false, message: `Stripe would not make a link: ${session.error}` };
    }

    const message = paymentLinkEmail({
      firstName: row.first_name,
      checkoutUrl: session.url,
      amountCents: row.amount_cents,
      serviceType: row.service_type,
      startsOn: row.starts_on,
      address: [row.line1, row.line2, `${row.city}, TX ${row.postal_code}`]
        .filter(Boolean)
        .join(", "),
      intervalDays: row.interval_days,
      recurring: kind === "membership",
    });

    const { delivered } = await sendEmail({
      to: row.email,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });

    revalidatePath("/admin");
    revalidatePath("/admin/members");

    return delivered
      ? { ok: true, message: `Sent to ${row.email}. The link is good for 24 hours.` }
      : {
          ok: false,
          message: "The email did not go. Try again, or send them the link by hand.",
        };
  } catch (err) {
    console.error(`[admin] could not send a payment link for ${kind} ${id}`, err);
    return { ok: false, message: "That did not go through. Please try again." };
  }
}
