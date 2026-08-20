"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { query } from "@/lib/db";
import { sendEmail } from "@/lib/email";
import { site } from "@/lib/site";
import { enquiryAlertEmail } from "@/lib/emails/enquiry-alert";

/**
 * A request to be quoted for a house.
 *
 * Not a booking and not a customer. Most enquiries never become either, and
 * writing a customer row for each one would fill the members list with people
 * who bought nothing and hand each of them an account they never asked for.
 * A real customer is created later, in admin, if the quote is accepted.
 *
 * Almost everything is optional on purpose. This is a lead, and every required
 * field is somewhere a person can decide the whole thing is too much effort.
 * Name, email and phone are the exception, because without a way to reply
 * there is nothing to act on.
 */

const schema = z.object({
  name: z.string().trim().min(1, "Your name is required").max(120),
  email: z.string().trim().max(200).pipe(z.email("Enter a valid email address")),
  phone: z.string().trim().min(7, "A phone number is required").max(40),
  address: z.string().trim().max(300).optional(),
  squareFeet: z.coerce.number().int().min(100).max(30000).optional(),
  hasPets: z.boolean(),
  serviceType: z.enum(["standard", "deep", "move_out", "not_sure"]),
  frequency: z.string().trim().max(120).optional(),
  message: z.string().trim().max(2000).optional(),
});

export type EnquiryResult = { ok: boolean; message: string };

function optionalNumber(raw: FormDataEntryValue | null): number | undefined {
  const value = typeof raw === "string" ? raw.trim() : "";
  return value === "" ? undefined : Number(value);
}

export async function submitEnquiry(form: FormData): Promise<EnquiryResult> {
  const text = (name: string) => {
    const raw = form.get(name);
    return typeof raw === "string" ? raw.trim() : "";
  };

  const parsed = schema.safeParse({
    name: text("name"),
    email: text("email"),
    phone: text("phone"),
    address: text("address") || undefined,
    squareFeet: optionalNumber(form.get("squareFeet")),
    hasPets: form.get("hasPets") === "on",
    serviceType: text("serviceType") || "not_sure",
    frequency: text("frequency") || undefined,
    message: text("message") || undefined,
  });

  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the details." };
  }
  const input = parsed.data;

  const head = await headers();
  const ip = head.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
  const userAgent = head.get("user-agent")?.slice(0, 500) || null;

  try {
    await query(
      `insert into enquiries
         (name, email, phone, address, square_feet,
          has_pets, service_type, frequency, message, ip_address, user_agent)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        input.name,
        input.email,
        input.phone,
        input.address ?? null,
        input.squareFeet ?? null,
        input.hasPets,
        input.serviceType,
        input.frequency ?? null,
        input.message ?? null,
        ip,
        userAgent,
      ],
    );
  } catch (err) {
    console.error("[enquiry] could not save", err);
    return {
      ok: false,
      message: "That did not send. Please try again, or call us instead.",
    };
  }

  // A lead that sits unseen is a lost one, and nobody refreshes an admin page
  // hoping for work. Sent after the row is safely stored, and never allowed to
  // fail the submission: the enquiry is already captured either way.
  //
  // Deliberately not alertOwner. That channel exists for the two failures
  // worth waking somebody for, subjects itself "Homewick needs a look", and
  // is plain text. A quote request is work arriving, and needs to be readable
  // on a phone like every other message this business sends.
  if (site.ownerEmail) {
    const mail = enquiryAlertEmail({
      name: input.name,
      email: input.email,
      phone: input.phone,
      address: input.address,
      squareFeet: input.squareFeet,
      hasPets: input.hasPets,
      serviceType: input.serviceType,
      frequency: input.frequency,
      message: input.message,
    });
    await sendEmail({
      to: site.ownerEmail,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    }).catch((err) => {
      console.error("[enquiry] alert did not send, the lead is still saved", err);
    });
  }

  // Warmer than "request sent". Somebody handing over their address and
  // asking a stranger into their home is making a small leap of trust, and a
  // receipt-shaped acknowledgement does not meet that. The spam line stays
  // because it is the one genuinely useful instruction here.
  return {
    ok: true,
    message:
      "We will look at what you have sent and come back with a price, usually the same day. It is a real person reading it, not an automated quote, so it might take a little longer if we are out on a job. Do have a look in your spam folder if you have not heard from us by tomorrow.",
  };
}
