"use server";

import { z } from "zod";
import { queryOne } from "@/lib/db";
import { requireAdmin } from "@/lib/admin-auth";
import { TIMEZONE } from "@/lib/dates";
import { sendEmail } from "@/lib/email";
import { bookingConfirmedEmail } from "@/lib/emails/templates";
import { propertyLabel, type ServiceType, type UnitSize } from "@/lib/pricing";

/**
 * Send the customer their booking details again.
 *
 * The confirmation goes out once, when a booking is created. That covers
 * everything made from now on and nothing made before, so a customer booked
 * while this did not exist has never had one, and there was no way to give
 * them one short of cancelling and re-entering the job.
 *
 * It is also the thing to press when somebody says they never got it, or when
 * a date has been talked about on the phone and they want it in writing
 * again.
 *
 * Plain send rather than sendOnce. That exists to stop a webhook firing twice;
 * this is a button pressed on purpose, and pressing it again because the
 * customer says nothing arrived has to actually send.
 */
export async function sendBookingConfirmation(
  raw: unknown,
): Promise<{ ok: boolean; message: string }> {
  const admin = await requireAdmin();
  if (!admin) return { ok: false, message: "Not signed in." };

  const visitId = z.string().uuid().safeParse(raw);
  if (!visitId.success) return { ok: false, message: "That booking could not be found." };

  try {
    const row = await queryOne<{
      first_name: string;
      email: string;
      service_type: ServiceType;
      on_date: string;
      line1: string;
      line2: string | null;
      city: string;
      postal_code: string;
      unit_size: UnitSize | null;
      bedrooms: number | null;
      bathrooms: string | null;
      price_cents: number;
      interval_days: number | null;
      recurring: boolean;
    }>(
      `select c.first_name, c.email::text as email, v.service_type,
              (v.scheduled_for at time zone $2)::date::text as on_date,
              p.line1, p.line2, p.city, p.postal_code,
              p.unit_size, p.bedrooms, p.bathrooms,
              coalesce(
                nullif(v.base_amount_cents + v.pet_surcharge_cents + v.addons_amount_cents, 0),
                s.monthly_amount_cents / greatest(s.visits_per_period, 1)
              ) as price_cents,
              s.interval_days,
              (v.subscription_id is not null) as recurring
         from visits v
         join customers c on c.id = v.customer_id
         join properties p on p.id = v.property_id
         left join subscriptions s on s.id = v.subscription_id
        where v.id = $1 and v.status <> 'canceled'`,
      [visitId.data, TIMEZONE],
    );

    if (!row) {
      return { ok: false, message: "That booking is cancelled or could not be found." };
    }

    const message = bookingConfirmedEmail({
      firstName: row.first_name,
      serviceType: row.service_type,
      onDate: row.on_date,
      address: [row.line1, row.line2, `${row.city}, TX ${row.postal_code}`]
        .filter(Boolean)
        .join(", "),
      property: propertyLabel({
        unitSize: row.unit_size,
        bedrooms: row.bedrooms,
        bathrooms: row.bathrooms,
      }),
      amountCents: row.price_cents,
      intervalDays: row.interval_days,
      recurring: row.recurring,
    });

    const { delivered } = await sendEmail({
      to: row.email,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });

    return delivered
      ? { ok: true, message: `Sent to ${row.email}.` }
      : { ok: false, message: "That did not send. Try again, or tell them yourself." };
  } catch (err) {
    console.error(`[admin] resending a confirmation failed for ${visitId.data}`, err);
    return { ok: false, message: "That did not go through. Please try again." };
  }
}
