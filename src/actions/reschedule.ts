"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { transaction } from "@/lib/db";
import { currentMember } from "@/lib/member-auth";
import {
  DEFAULT_VISIT_TIME,
  TIMEZONE,
  addDays,
  formatLong,
  isISODate,
  today,
  weekday,
} from "@/lib/dates";
import { MIN_LEAD_DAYS, visitDatesForPeriod } from "@/lib/membership-lifecycle";

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
    );
    const target = wanted[slot];
    if (!target) continue;

    const { rows: visits } = await client.query<{ id: string }>(
      `select id from visits
        where period_id = $1
          and status = 'scheduled'
        order by scheduled_for
        offset $2 limit 1
        for update`,
      [period.id, slot],
    );
    if (!visits[0]) continue;

    await client.query(
      `update visits
          set scheduled_for = (($2::date + $3::time) at time zone $4)
        where id = $1`,
      [visits[0].id, target, DEFAULT_VISIT_TIME, TIMEZONE],
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
    return await transaction(async (client) => {
      const { rows } = await client.query<{
        id: string;
        subscription_id: string | null;
        period_start: string | null;
        period_end: string | null;
        slot: string;
      }>(
        `select v.id, v.subscription_id,
                sp.period_start::text, sp.period_end::text,
                (
                  select count(*) from visits other
                   where other.period_id = v.period_id
                     and other.status <> 'canceled'
                     and other.scheduled_for < v.scheduled_for
                )::text as slot
           from visits v
           left join subscription_periods sp on sp.id = v.period_id
          where v.id = $1
            and v.customer_id = $2
            and v.status in ('scheduled', 'assigned')
          for update of v`,
        [id.data, member.customerId],
      );

      const visit = rows[0];
      if (!visit) {
        return { ok: false as const, message: "That cleaning cannot be moved." };
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

      await client.query(
        `update visits
            set scheduled_for = (($2::date + $3::time) at time zone $4)
          where id = $1`,
        [visit.id, date.data, DEFAULT_VISIT_TIME, TIMEZONE],
      );

      // Remember the weekday for this slot, then move the same slot in every
      // period that has not started yet. Remembering alone would leave the
      // months already on the calendar sitting on the old day, so a member who
      // moved to Tuesday would still see Thursdays listed and reasonably think
      // it had not worked.
      if (visit.subscription_id) {
        const slot = Number(visit.slot);
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
      return {
        ok: true as const,
        message: `Moved to ${formatLong(date.data)}. We will keep that day for future cleanings unless you change it again.`,
      };
    });
  } catch (err) {
    console.error("[account] reschedule failed", err);
    return { ok: false, message: "That did not save. Please try again." };
  }
}
