"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { transaction } from "@/lib/db";
import { requireAdmin } from "@/lib/admin-auth";
import { splitHousePay, visitPriceCents } from "@/lib/crew-pay";
import { notifyCleaner } from "./cleaners";

/**
 * Put a crew on a job.
 *
 * Replaces assigning a single cleaner, because a house needs two or three
 * people and the old single column meant everybody after the first got no job
 * email, no entry code, and no pay.
 *
 * Pay is worked out here and stored, never recalculated afterwards. Adding a
 * third cleaner next week must not restate what the first two were already
 * owed for a job they have finished, and a rate agreed on a call is not
 * something a later edit should silently revise.
 *
 * The two pay models are genuinely different products, so they branch rather
 * than being forced into one formula:
 *
 *   house       half the job price across the crew, lead takes $15 first
 *   apartment   one cleaner on their own percentage, exactly as before
 */

type Result = { ok: boolean; message: string };

const schema = z.object({
  visitId: z.string().uuid(),
  members: z
    .array(z.object({ cleanerId: z.string().uuid(), isLead: z.boolean() }))
    .max(6),
});

export async function setVisitCrew(raw: unknown): Promise<Result> {
  const admin = await requireAdmin();
  if (!admin) return { ok: false, message: "Not signed in." };

  const parsed = schema.safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Unknown visit or cleaner." };
  const { visitId, members } = parsed.data;

  const unique = new Set(members.map((m) => m.cleanerId));
  if (unique.size !== members.length) {
    return { ok: false, message: "Somebody is on the crew twice." };
  }
  if (members.length > 0 && members.filter((m) => m.isLead).length !== 1) {
    return { ok: false, message: "Pick exactly one lead." };
  }

  try {
    const outcome = await transaction(async (client) => {
      const { rows: visitRows } = await client.query<{
        status: string;
        base_amount_cents: number;
        pet_surcharge_cents: number;
        addons_amount_cents: number;
        property_kind: "apartment" | "house";
        sub_amount: number | null;
        visits_per_period: number | null;
      }>(
        `select v.status::text as status, v.base_amount_cents, v.pet_surcharge_cents,
                v.addons_amount_cents, p.property_kind::text as property_kind,
                s.monthly_amount_cents as sub_amount, s.visits_per_period
           from visits v
           join properties p on p.id = v.property_id
           left join subscriptions s on s.id = v.subscription_id
          where v.id = $1
          for update of v`,
        [visitId],
      );
      const visit = visitRows[0];
      if (!visit) return { ok: false as const, message: "Unknown visit." };
      if (visit.status === "canceled") {
        return { ok: false as const, message: "That visit is cancelled." };
      }

      // Who is already on it, and who has been paid. A settled row is left
      // exactly as it is: that money has left the bank and the record of it
      // is not ours to rewrite.
      const { rows: existing } = await client.query<{
        cleaner_id: string;
        paid_at: Date | null;
      }>(`select cleaner_id, paid_at from visit_cleaners where visit_id = $1`, [visitId]);

      const settled = new Set(
        existing.filter((e) => e.paid_at !== null).map((e) => e.cleaner_id),
      );
      const removing = existing
        .filter((e) => !members.some((m) => m.cleanerId === e.cleaner_id))
        .map((e) => e.cleaner_id);

      const settledRemoval = removing.filter((id) => settled.has(id));
      if (settledRemoval.length > 0) {
        return {
          ok: false as const,
          message:
            "Somebody on this job has already been paid, so the crew cannot be changed. Adjust it on their next job instead.",
        };
      }

      const price = visitPriceCents({
        baseCents: visit.base_amount_cents,
        petSurchargeCents: visit.pet_surcharge_cents,
        addOnsCents: visit.addons_amount_cents,
        subscriptionAmountCents: visit.sub_amount,
        visitsPerPeriod: visit.visits_per_period,
      });

      let payouts: { cleanerId: string; payCents: number | null }[];

      if (visit.property_kind === "house" && members.length > 0) {
        try {
          payouts = splitHousePay(price, members);
        } catch (err) {
          return {
            ok: false as const,
            message:
              err instanceof Error ? err.message : "That crew could not be priced.",
          };
        }
      } else {
        // Apartments are unchanged: each cleaner's own percentage of the job,
        // and no rate set means no figure rather than a zero, so the pay page
        // can say "no rate" instead of quietly implying they work for free.
        const { rows: rates } = await client.query<{
          id: string;
          pay_percent_bp: number | null;
        }>(`select id, pay_percent_bp from cleaners where id = any($1::uuid[])`, [
          members.map((m) => m.cleanerId),
        ]);
        payouts = members.map((m) => {
          const bp = rates.find((r) => r.id === m.cleanerId)?.pay_percent_bp ?? null;
          return {
            cleanerId: m.cleanerId,
            payCents: bp == null ? null : Math.floor((price * bp) / 10000),
          };
        });
      }

      await client.query(
        `delete from visit_cleaners where visit_id = $1 and cleaner_id <> all($2::uuid[])`,
        [visitId, members.map((m) => m.cleanerId)],
      );

      for (const m of members) {
        const pay = payouts.find((p) => p.cleanerId === m.cleanerId)?.payCents ?? null;
        await client.query(
          `insert into visit_cleaners (visit_id, cleaner_id, is_lead, pay_cents)
           values ($1, $2, $3, $4)
           on conflict (visit_id, cleaner_id) do update
             set is_lead = excluded.is_lead,
                 -- Only while unpaid. A settled figure stands.
                 pay_cents = case when visit_cleaners.paid_at is null
                                  then excluded.pay_cents
                                  else visit_cleaners.pay_cents end`,
          [visitId, m.cleanerId, m.isLead, pay],
        );
      }

      // Kept in step so the schedule, history, and job links still resolve a
      // single name without every one of them being rewritten at once.
      await client.query(
        `update visits
            set assigned_cleaner_id = $2,
                status = case
                           when $2::uuid is null and status = 'assigned' then 'scheduled'
                           when $2::uuid is not null and status = 'scheduled' then 'assigned'
                           else status
                         end
          where id = $1`,
        [visitId, members.find((m) => m.isLead)?.cleanerId ?? null],
      );

      const added = members
        .filter((m) => !existing.some((e) => e.cleaner_id === m.cleanerId))
        .map((m) => m.cleanerId);

      return { ok: true as const, message: "", added };
    });

    if (!outcome.ok) return outcome;

    // Every newly added person gets the job in their inbox, with their own
    // entry-code link. A crew where only one person can get in is a crew that
    // has to arrive together.
    for (const cleanerId of outcome.added) {
      await notifyCleaner(visitId, cleanerId);
    }

    revalidatePath("/admin");
    revalidatePath("/admin/pay");

    const n = members.length;
    return {
      ok: true,
      message:
        n === 0
          ? "Crew cleared."
          : `${n} cleaner${n === 1 ? "" : "s"} on the job${outcome.added.length ? ", and the new ones have been emailed" : ""}.`,
    };
  } catch (err) {
    console.error("[admin] setting crew failed", err);
    return { ok: false, message: "That did not save. Please try again." };
  }
}
