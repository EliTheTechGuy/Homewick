import { query } from "../db";
import { TIMEZONE, today, type ISODate } from "../dates";
import { sendOnce } from "./send-once";
import { visitReminderEmail } from "./templates";

/**
 * Tell somebody a cleaner is coming.
 *
 * Normally sent by the daily job the morning before, which is where it
 * belongs: far enough ahead to move things, close enough to still be true.
 *
 * The exception is a booking made after that morning has already gone. A job
 * agreed at five in the afternoon for nine tomorrow would wait for the next
 * run, which fires at nine, at the same moment somebody knocks on the door.
 * So a booking created inside the window sends its reminder there and then.
 *
 * Keyed on the visit and the day it falls on. The daily job uses the same key,
 * so whichever gets there first wins and the other quietly does nothing, and a
 * cleaning that is later moved still earns a reminder for its new day.
 */
export async function sendVisitReminder(
  visitId: string,
  from: ISODate = today(),
): Promise<{ sent: boolean }> {
  const rows = await query<{
    customer_id: string;
    first_name: string;
    email: string;
    on_date: string;
    line1: string;
    line2: string | null;
    city: string;
    postal_code: string;
    free_add_on: string | null;
  }>(
    `select c.id as customer_id, c.first_name, c.email::text as email,
            (v.scheduled_for at time zone $2)::date::text as on_date,
            p.line1, p.line2, p.city, p.postal_code,
            (select a.name from visit_add_ons va
               join add_ons a on a.id = va.add_on_id
              where va.visit_id = v.id and va.is_free_perk
              limit 1) as free_add_on
       from visits v
       join customers c on c.id = v.customer_id
       join properties p on p.id = v.property_id
      where v.id = $1 and v.status in ('scheduled', 'assigned')`,
    [visitId, TIMEZONE],
  );
  const visit = rows[0];
  if (!visit) return { sent: false };

  return sendOnce({
    eventKey: `visit:${visitId}:${visit.on_date}`,
    kind: "visit_reminder",
    to: visit.email,
    customerId: visit.customer_id,
    message: visitReminderEmail({
      firstName: visit.first_name,
      onDate: visit.on_date,
      when: visit.on_date === from ? "today" : "tomorrow",
      address: [visit.line1, visit.line2, `${visit.city}, TX ${visit.postal_code}`]
        .filter(Boolean)
        .join(", "),
      freeAddOnName: visit.free_add_on,
    }),
  }).then((r) => ({ sent: r.sent }));
}

/** How far ahead a booking is close enough to warrant reminding immediately. */
export const REMIND_ON_BOOKING_DAYS = 1;
