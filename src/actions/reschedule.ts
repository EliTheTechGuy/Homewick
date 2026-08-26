"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { transaction } from "@/lib/db";
import { currentMember } from "@/lib/member-auth";
import {
  TIMEZONE,
  addDays,
  formatLong,
  isISODate,
  today,
  type ISODate,
  weekday,
} from "@/lib/dates";
import { MIN_LEAD_DAYS, visitDatesForPeriod } from "@/lib/membership-lifecycle";
import { queryOne } from "@/lib/db";
import { sendOnce } from "@/lib/emails/send-once";
import { visitMovedAlertEmail } from "@/lib/emails/templates";
import { notifyCleaner } from "@/actions/cleaners";
import { site } from "@/lib/site";

type Client = Parameters<Parameters<typeof transaction>[0]>[0];

/**
 * Push a changed weekday out into the months already on the calendar.
 *
 * Only periods that have not started yet are touched. The period in progress
 * is left alone on purpose: its dates are the ones the member is looking at
 * and may have set by hand, and quietly shuffling the other cleaning in the
 * same month because they moved this one would be the opposite of what they
 * asked for.
 *
 * Visits that are already assigned to a cleaner are skipped too. Those are
 * committed work, so they get moved deliberately rather than as a side effect.
 * Skipping one must not shift the others, which is why a visit is found by
 * its stored slot rather than by counting along the period.
 */
async function realignFuturePeriods(
  client: Client,
  subscriptionId: string,
  slot: number,
  prefs: {
    preferred_weekday: number | null;
    preferred_weekday_second: number | null;
    visits_per_period: number;
  } | undefined,
): Promise<void> {
  if (!prefs) return;

  const weekdays = [prefs.preferred_weekday, prefs.preferred_weekday_second];
  const from = today();
  // The same notice a member has to give applies to a move they did not ask
  // for. A period starting tomorrow qualifies as "not started yet", so
  // without a floor its cleaning could be pulled to tomorrow, which is a rule
  // this very file enforces against the member two hundred lines below.
  const notBefore = addDays(from, MIN_LEAD_DAYS);

  const { rows: periods } = await client.query<{
    id: string;
    period_start: string;
    period_end: string;
  }>(
    `select id, period_start::text, period_end::text
       from subscription_periods
      where subscription_id = $1
        and period_start > $2
      order by period_start`,
    [subscriptionId, from],
  );

  for (const period of periods) {
    const wanted = visitDatesForPeriod(
      { start: period.period_start, end: period.period_end },
      weekdays,
      prefs.visits_per_period,
      notBefore,
    );
    const target = wanted[slot];
    if (!target) continue;

    // Found by its stored slot rather than by counting scheduled visits.
    // Counting skipped assigned ones, which shifted every later offset: a
    // September period whose first clean was already assigned would have its
    // *second* one moved into the first week, collapsing both into one
    // fortnight and losing the member half a month of service.
    const { rows: visits } = await client.query<{ id: string; status: string }>(
      `select id, status::text as status from visits
        where period_id = $1 and slot = $2 and status <> 'canceled'
        limit 1
        for update`,
      [period.id, slot],
    );
    if (!visits[0]) continue;

    // Assigned work is somebody's day already planned. Skipped, not moved,
    // and skipping it must not shift anything else, which is why the lookup
    // above is by slot rather than by position.
    if (visits[0].status === "assigned") continue;

    // Nothing to do, and writing anyway would stamp a reschedule trail on a
    // visit that never moved.
    const { rows: current } = await client.query<{ on_date: string }>(
      `select (scheduled_for at time zone $2)::date::text as on_date
         from visits where id = $1`,
      [visits[0].id, TIMEZONE],
    );
    if (current[0]?.on_date === target) continue;

    // The day moves, the time does not. Rewriting it to the default meant a
    // ten o'clock customer quietly became a nine o'clock one the first time
    // anything was rescheduled, and nobody would be told.
    await client.query(
      `update visits
          set scheduled_for =
                (($2::date + (scheduled_for at time zone $3)::time) at time zone $3)
        where id = $1`,
      [visits[0].id, target, TIMEZONE],
    );
  }
}

/**
 * Move a cleaning, and remember the new day for future months.
 *
 * A member picks whatever date suits them. The weekday they land on becomes
 * the default for that slot from the next period onward, so somebody who
 * shifts their second clean to a Wednesday keeps getting Wednesdays without
 * having to move it again every month.
 *
 * The new date has to stay inside the same billing period. That is the no
 * rollover rule from the brief: a cleaning pushed into next month would be an
 * extra visit there and a missing one here, and the period ledger is what
 * enforces two cleanings a month.
 */
export async function rescheduleVisit(
  visitId: unknown,
  newDate: unknown,
): Promise<{ ok: boolean; message: string }> {
  const member = await currentMember();
  if (!member) return { ok: false, message: "Please sign in again." };

  const id = z.string().uuid().safeParse(visitId);
  const date = z.string().trim().refine(isISODate, "Choose a date").safeParse(newDate);
  if (!id.success || !date.success) {
    return { ok: false, message: "Choose a date to move it to." };
  }

  const earliest = addDays(today(), MIN_LEAD_DAYS);
  if (date.data < earliest) {
    return {
      ok: false,
      message: `We need a couple of days' notice, so the earliest we can do is ${formatLong(earliest)}.`,
    };
  }

  try {
    const outcome = await transaction(async (client) => {
      const { rows } = await client.query<{
        id: string;
        subscription_id: string | null;
        period_start: string | null;
        period_end: string | null;
        slot: number | null;
        period_id: string | null;
        from_date: string;
        assigned_cleaner_id: string | null;
      }>(
        // The slot is read, not counted. Deriving it from date order meant
        // that moving the second cleaning earlier turned it into the first,
        // so the next move wrote to the wrong remembered weekday.
        `select v.id, v.subscription_id, v.slot, v.period_id,
                (v.scheduled_for at time zone $3)::date::text as from_date,
                v.assigned_cleaner_id,
                sp.period_start::text, sp.period_end::text
           from visits v
           left join subscription_periods sp on sp.id = v.period_id
          where v.id = $1
            and v.customer_id = $2
            and v.status in ('scheduled', 'assigned')
          for update of v`,
        [id.data, member.customerId, TIMEZONE],
      );

      const visit = rows[0];
      if (!visit) {
        return { ok: false as const, message: "That cleaning cannot be moved." };
      }

      // Two cleanings on one morning is not a schedule, it is the whole
      // month's service used up in a day with two crews sent to one door.
      // Nothing stopped it, because moving a visit bypasses the generator
      // that normally spaces them.
      if (visit.period_id) {
        const { rows: clash } = await client.query<{ id: string }>(
          `select id from visits
            where period_id = $1
              and id <> $2
              and status <> 'canceled'
              and (scheduled_for at time zone $4)::date = $3::date
            limit 1`,
          [visit.period_id, visit.id, date.data, TIMEZONE],
        );
        if (clash.length > 0) {
          return {
            ok: false as const,
            message: `Your other cleaning is already on ${formatLong(date.data)}. Pick a different day so they are not both on the same morning.`,
          };
        }
      }

      // Membership visits belong to a period and must stay in it.
      if (visit.period_start && visit.period_end) {
        if (date.data < visit.period_start || date.data >= visit.period_end) {
          return {
            ok: false as const,
            message: `That date is outside this month's period. Pick a date before ${formatLong(visit.period_end)}, since cleanings do not carry over.`,
          };
        }
      }

      // rescheduled_from keeps the value it had a moment ago, so the schedule
      // can show where a visit came from rather than only where it is now.
      await client.query(
        `update visits
            set rescheduled_from = scheduled_for,
                rescheduled_at = now(),
                scheduled_for =
                  (($2::date + (scheduled_for at time zone $3)::time) at time zone $3)
          where id = $1`,
        [visit.id, date.data, TIMEZONE],
      );

      // Remember the weekday for this slot, then move the same slot in every
      // period that has not started yet. Remembering alone would leave the
      // months already on the calendar sitting on the old day, so a member who
      // moved to Tuesday would still see Thursdays listed and reasonably think
      // it had not worked.
      if (visit.subscription_id && visit.slot !== null) {
        const slot = visit.slot;
        const column = slot === 0 ? "preferred_weekday" : "preferred_weekday_second";

        const { rows: subRows } = await client.query<{
          preferred_weekday: number | null;
          preferred_weekday_second: number | null;
          visits_per_period: number;
        }>(
          `update subscriptions set ${column} = $2, updated_at = now()
            where id = $1
            returning preferred_weekday, preferred_weekday_second, visits_per_period`,
          [visit.subscription_id, weekday(date.data)],
        );

        await realignFuturePeriods(client, visit.subscription_id, slot, subRows[0]);
      }

      revalidatePath("/account");
      revalidatePath("/admin");
      return {
        ok: true as const,
        message: `Moved to ${formatLong(date.data)}. We will keep that day for future cleanings unless you change it again.`,
        moved: { visitId: visit.id, from: visit.from_date, to: date.data,
                 cleanerId: visit.assigned_cleaner_id },
      };
    });
    // Notifications go out after the transaction commits, not inside it. A
    // mail provider having a bad minute must not roll back a move the member
    // has already been told succeeded.
    if (outcome.ok && "moved" in outcome && outcome.moved) {
      await notifyVisitMoved(outcome.moved);
    }

    return { ok: outcome.ok, message: outcome.message };
  } catch (err) {
    console.error("[account] reschedule failed", err);
    return { ok: false, message: "That did not save. Please try again." };
  }
}

/**
 * Tell the people who need to know that a cleaning moved.
 *
 * The owner always, because the board changed without them touching it: the
 * old day may now have a gap and the new day may need looking at. The assigned
 * cleaner only if there is one, because they were sent the old date and would
 * otherwise turn up on it.
 *
 * Failures are logged and swallowed. The move itself has already happened and
 * been confirmed to the member, so throwing here would report a failure that
 * did not occur.
 */
async function notifyVisitMoved(moved: {
  visitId: string;
  from: ISODate;
  to: ISODate;
  cleanerId: string | null;
}): Promise<void> {
  if (moved.cleanerId) {
    await notifyCleaner(moved.visitId, moved.cleanerId, "moved");
  }

  if (!site.ownerEmail) return;

  try {
    const row = await queryOne<{
      first_name: string;
      last_name: string;
      phone: string;
      line1: string;
      line2: string | null;
      city: string;
      postal_code: string;
      cleaner_name: string | null;
    }>(
      `select c.first_name, c.last_name, c.phone,
              p.line1, p.line2, p.city, p.postal_code,
              cl.first_name || ' ' || cl.last_name as cleaner_name
         from visits v
         join customers c on c.id = v.customer_id
         join properties p on p.id = v.property_id
         left join cleaners cl on cl.id = v.assigned_cleaner_id
        where v.id = $1`,
      [moved.visitId],
    );
    if (!row) return;

    // Keyed on both dates, so moving the same visit again is a fresh alert
    // while a retry of this one is not.
    await sendOnce({
      eventKey: `visit:${moved.visitId}:moved:${moved.from}:${moved.to}`,
      kind: "visit_moved_alert",
      to: site.ownerEmail,
      customerId: null,
      message: visitMovedAlertEmail({
        customerName: `${row.first_name} ${row.last_name}`,
        customerPhone: row.phone,
        fromDate: moved.from,
        toDate: moved.to,
        address: [row.line1, row.line2, `${row.city}, TX ${row.postal_code}`]
          .filter(Boolean)
          .join(", "),
        cleanerName: row.cleaner_name,
        adminUrl: `${site.url}/admin?date=${moved.to}`,
      }),
    });
  } catch (err) {
    console.error(`[email] moved alert failed for visit ${moved.visitId}`, err);
  }
}
