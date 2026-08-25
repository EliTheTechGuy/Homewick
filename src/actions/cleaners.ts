"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { query, queryOne, transaction } from "@/lib/db";
import { requireAdmin } from "@/lib/admin-auth";
import { TIMEZONE } from "@/lib/dates";
import { sendOnce } from "@/lib/emails/send-once";
import { cleanerAssignmentEmail } from "@/lib/emails/templates";
import { site } from "@/lib/site";
import { visitUrl } from "@/lib/visit-links";
import { propertyLabel, type ServiceType, type UnitSize } from "@/lib/pricing";

type Result = { ok: boolean; message: string };

const cleanerSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required").max(80),
  lastName: z.string().trim().min(1, "Last name is required").max(80),
  phone: z.string().trim().min(7, "Phone number is required").max(40),
  email: z.string().trim().max(200).pipe(z.email("Enter a valid email address")),
});

function field(form: FormData, name: string): string {
  const raw = form.get(name);
  return typeof raw === "string" ? raw.trim() : "";
}

/** Add somebody to the roster. Email is required, since that is how they get work. */
export async function addCleaner(form: FormData): Promise<Result> {
  const admin = await requireAdmin();
  if (!admin) return { ok: false, message: "Not authorized." };

  const parsed = cleanerSchema.safeParse({
    firstName: field(form, "firstName"),
    lastName: field(form, "lastName"),
    phone: field(form, "phone"),
    email: field(form, "email"),
  });
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the details." };
  }

  try {
    await query(
      `insert into cleaners (first_name, last_name, phone, email, hired_on, is_active)
       values ($1, $2, $3, $4, current_date, true)`,
      [parsed.data.firstName, parsed.data.lastName, parsed.data.phone, parsed.data.email],
    );
    revalidatePath("/admin/cleaners");
    return { ok: true, message: `${parsed.data.firstName} is on the roster.` };
  } catch (err) {
    if (err instanceof Error && /unique/i.test(err.message)) {
      return { ok: false, message: "Somebody on the roster already uses that email." };
    }
    console.error("[admin] adding cleaner failed", err);
    return { ok: false, message: "That did not save. Please try again." };
  }
}

/**
 * Take somebody off the roster without deleting them.
 *
 * Past visits point at a cleaner, so removing the row would either fail on the
 * foreign key or blank out who did the work. Deactivating keeps the history
 * readable and takes them out of the assignment list.
 */
export async function setCleanerActive(
  cleanerId: unknown,
  active: unknown,
): Promise<Result> {
  const admin = await requireAdmin();
  if (!admin) return { ok: false, message: "Not authorized." };

  const id = z.string().uuid().safeParse(cleanerId);
  const on = z.boolean().safeParse(active);
  if (!id.success || !on.success) return { ok: false, message: "Unknown cleaner." };

  try {
    await query(`update cleaners set is_active = $2 where id = $1`, [id.data, on.data]);
    revalidatePath("/admin/cleaners");
    return { ok: true, message: on.data ? "Back on the roster." : "Taken off the roster." };
  } catch (err) {
    console.error("[admin] updating cleaner failed", err);
    return { ok: false, message: "That did not save. Please try again." };
  }
}

/**
 * Put a cleaner on a job, and tell them.
 *
 * The email is the whole point: a cleaner with no account only knows about
 * work because it arrived in their inbox. It carries everything except the
 * entry code, which stays behind a link that only opens on the day and writes
 * an audit row when used. A door code sitting in an inbox forever is readable
 * by anyone who ever gets into that inbox, and leaves with the person.
 *
 * Re-assigning the same cleaner is a no-op rather than a second email.
 */
export async function assignCleaner(
  visitId: unknown,
  cleanerId: unknown,
): Promise<Result> {
  const admin = await requireAdmin();
  if (!admin) return { ok: false, message: "Not authorized." };

  const visit = z.string().uuid().safeParse(visitId);
  // An empty string means "unassign", which is a legitimate thing to want.
  const cleaner =
    cleanerId === "" || cleanerId === null
      ? { success: true as const, data: null }
      : z.string().uuid().safeParse(cleanerId);

  if (!visit.success || !cleaner.success) {
    return { ok: false, message: "Unknown visit or cleaner." };
  }
  const nextCleanerId = "data" in cleaner ? (cleaner.data as string | null) : null;

  try {
    const changed = await transaction(async (client) => {
      const { rows } = await client.query<{
        previous: string | null;
        status: string;
      }>(
        `select assigned_cleaner_id as previous, status::text as status
           from visits where id = $1 for update`,
        [visit.data],
      );
      const current = rows[0];
      if (!current) return { ok: false as const, message: "Unknown visit." };
      if (current.status === "canceled") {
        return { ok: false as const, message: "That visit is cancelled." };
      }
      if (current.previous === nextCleanerId) {
        return { ok: false as const, message: "No change, they were already on it." };
      }

      // Pay is snapshotted here, from the cleaner's rate at the moment they
      // take the job, and never recalculated afterwards. Raising somebody's
      // rate must not quietly change what they were owed for work already
      // done, and lowering it must not either.
      //
      // Left alone once the visit has been paid, so a reassignment after
      // settlement cannot rewrite a figure that has already left the bank.
      // Cleared on unassignment, but only while still unpaid.
      await client.query(
        `update visits v
            set assigned_cleaner_id = $2,
                status = case
                           when $2::uuid is null and status = 'assigned' then 'scheduled'
                           when $2::uuid is not null and status = 'scheduled' then 'assigned'
                           else status
                         end,
                cleaner_pay_cents = case
                  when v.cleaner_paid_at is not null then v.cleaner_pay_cents
                  when $2::uuid is null then null
                  else (
                    select case when c.pay_percent_bp is null then null
                                else ((v.base_amount_cents + v.pet_surcharge_cents
                                       + v.addons_amount_cents) * c.pay_percent_bp) / 10000
                           end
                      from cleaners c where c.id = $2::uuid
                  )
                end
          where v.id = $1`,
        [visit.data, nextCleanerId],
      );

      return { ok: true as const, message: "" };
    });

    if (!changed.ok) return changed;

    if (nextCleanerId) await notifyCleaner(visit.data, nextCleanerId);

    revalidatePath("/admin");
    return {
      ok: true,
      message: nextCleanerId ? "Assigned, and they have been emailed." : "Unassigned.",
    };
  } catch (err) {
    console.error("[admin] assigning cleaner failed", err);
    return { ok: false, message: "That did not save. Please try again." };
  }
}

/**
 * Send the job to the cleaner.
 *
 * Keyed on the visit, the cleaner and the date, so re-sending after a
 * reschedule reaches them again while a double click does not.
 */
export async function notifyCleaner(
  visitId: string,
  cleanerId: string,
  reason: "assigned" | "moved" = "assigned",
): Promise<void> {
  try {
    const row = await queryOne<{
      cleaner_first: string;
      cleaner_email: string | null;
      customer_first: string;
      customer_last: string;
      customer_phone: string;
      service_type: ServiceType;
      unit_size: UnitSize | null;
      bedrooms: number | null;
      bathrooms: string | null;
      has_pets: boolean;
      on_date: string;
      at_time: string;
      line1: string;
      line2: string | null;
      city: string;
      postal_code: string;
      customer_instructions: string | null;
      add_ons: string[] | null;
      has_entry_details: boolean;
    }>(
      `select cl.first_name as cleaner_first, cl.email::text as cleaner_email,
              c.first_name as customer_first, c.last_name as customer_last, c.phone as customer_phone,
              v.service_type, p.unit_size, p.bedrooms, p.bathrooms, p.has_pets,
              (v.scheduled_for at time zone $2)::date::text as on_date,
              to_char(v.scheduled_for at time zone $2, 'HH12:MI AM') as at_time,
              p.line1, p.line2, p.city, p.postal_code,
              v.customer_instructions,
              (select array_agg(a.name order by a.sort_order)
                 from visit_add_ons va join add_ons a on a.id = va.add_on_id
                where va.visit_id = v.id) as add_ons,
              exists (select 1 from property_access_secrets s where s.property_id = p.id)
                as has_entry_details
         from visits v
         join cleaners cl on cl.id = $3
         join customers c on c.id = v.customer_id
         join properties p on p.id = v.property_id
        where v.id = $1`,
      [visitId, TIMEZONE, cleanerId],
    );

    if (!row?.cleaner_email) return;

    await sendOnce({
      eventKey: `visit:${visitId}:cleaner:${cleanerId}:${row.on_date}:${reason}`,
      kind: "cleaner_assignment",
      to: row.cleaner_email,
      customerId: null,
      message: cleanerAssignmentEmail({
        reason,
        cleanerFirstName: row.cleaner_first,
        customerName: `${row.customer_first} ${row.customer_last}`,
        customerPhone: row.customer_phone,
        serviceType: row.service_type,
        property: propertyLabel({
          unitSize: row.unit_size,
          bedrooms: row.bedrooms,
          bathrooms: row.bathrooms,
        }),
        onDate: row.on_date,
        atTime: row.at_time,
        address: [row.line1, row.line2, `${row.city}, TX ${row.postal_code}`]
          .filter(Boolean)
          .join(", "),
        hasPets: row.has_pets,
        addOns: row.add_ons ?? [],
        instructions: row.customer_instructions,
        jobUrl: visitUrl(site.url, visitId),
        hasEntryDetails: row.has_entry_details,
      }),
    });
  } catch (err) {
    // A missing email costs the cleaner a phone call. Throwing here would
    // roll back an assignment that is otherwise correct.
    console.error(`[email] cleaner notification failed for visit ${visitId}`, err);
  }
}

/**
 * Set what share of a visit a cleaner keeps, in whole percent.
 *
 * Applies to work assigned from now on. Visits already assigned keep the
 * figure snapshotted at the time, because renegotiating a rate is not the same
 * as retrospectively changing what somebody earned last week.
 */
export async function setCleanerRate(form: FormData): Promise<Result> {
  const admin = await requireAdmin();
  if (!admin) return { ok: false, message: "Not signed in." };

  const id = z.string().uuid().safeParse(field(form, "cleanerId"));
  if (!id.success) return { ok: false, message: "Unknown cleaner." };

  const raw = field(form, "percent");
  // Blank clears the rate, which is different from setting it to zero: one
  // says "not agreed yet", the other says "they work for free".
  if (raw === "") {
    await query(`update cleaners set pay_percent_bp = null where id = $1`, [id.data]);
    revalidatePath("/admin/pay");
    return { ok: true, message: "Rate cleared." };
  }

  const percent = Number(raw);
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
    return { ok: false, message: "Enter a percentage between 0 and 100." };
  }

  await query(`update cleaners set pay_percent_bp = $2 where id = $1`, [
    id.data,
    Math.round(percent * 100),
  ]);
  revalidatePath("/admin/pay");
  return { ok: true, message: `Rate set to ${percent}% of each visit.` };
}

/**
 * Mark everything currently owed to one cleaner as paid.
 *
 * Settles the visits that were outstanding when the button was pressed, chosen
 * by id rather than by re-running the "unpaid" query inside the update. A visit
 * completed in the seconds between loading the page and confirming would
 * otherwise be marked paid without being part of the amount actually sent.
 *
 * They all share one timestamp, which is what groups a week's run back together
 * when reconciling against a bank statement later.
 */
export async function markCleanerPaid(form: FormData): Promise<Result> {
  const admin = await requireAdmin();
  if (!admin) return { ok: false, message: "Not signed in." };

  const cleanerId = z.string().uuid().safeParse(field(form, "cleanerId"));
  if (!cleanerId.success) return { ok: false, message: "Unknown cleaner." };

  const visitIds = form
    .getAll("visitId")
    .filter((v): v is string => typeof v === "string");
  const ids = z.array(z.string().uuid()).safeParse(visitIds);
  if (!ids.success || ids.data.length === 0) {
    return { ok: false, message: "Nothing outstanding to pay." };
  }

  const reference = field(form, "reference").slice(0, 200) || null;

  const settled = await query<{ id: string }>(
    `update visits
        set cleaner_paid_at = now(),
            cleaner_payment_ref = $3
      where id = any($1::uuid[])
        and assigned_cleaner_id = $2
        and cleaner_paid_at is null
        and cleaner_pay_cents is not null
      returning id`,
    [ids.data, cleanerId.data, reference],
  );

  revalidatePath("/admin/pay");
  const n = settled.length;
  return n
    ? { ok: true, message: `Marked ${n} visit${n === 1 ? "" : "s"} as paid.` }
    : { ok: false, message: "Those were already settled. Nothing changed." };
}
