import type { Metadata } from "next";
import Link from "next/link";
import { query } from "@/lib/db";
import { requireAdmin } from "@/lib/admin-auth";
import { TIMEZONE } from "@/lib/dates";
import { CleanerPayCard } from "@/components/admin/CleanerPayCard";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Cleaner pay",
  robots: { index: false, follow: false },
};

type Row = {
  cleaner_id: string;
  first_name: string;
  last_name: string;
  email: string;
  pay_percent_bp: number | null;
  is_active: boolean;
  visit_id: string | null;
  on_date: string | null;
  service_type: string | null;
  visit_total_cents: number | null;
  pay_cents: number | null;
  is_lead: boolean | null;
};

function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/**
 * What each cleaner is owed, and a way to record having paid them.
 *
 * Payment happens by bank transfer outside this system, so nothing here moves
 * money. It answers the two questions a weekly run actually needs: who is owed
 * what, and which visits that covers, then records the answer so the same work
 * is not paid twice and so the year-end totals are there for 1099s.
 *
 * Only completed visits count. Paying for work that has not happened yet is a
 * decision, not a default.
 */
export default async function CleanerPayPage() {
  const admin = await requireAdmin();
  if (!admin) return null;

  const rows = await query<Row>(
    `select c.id as cleaner_id, c.first_name, c.last_name, c.email::text as email,
            c.pay_percent_bp, c.is_active,
            v.id as visit_id,
            (v.scheduled_for at time zone $1)::date::text as on_date,
            v.service_type::text as service_type,
            (v.base_amount_cents + v.pet_surcharge_cents + v.addons_amount_cents)
              as visit_total_cents,
            vc.pay_cents as pay_cents,
            vc.is_lead
       from cleaners c
       left join visit_cleaners vc
         on vc.cleaner_id = c.id and vc.paid_at is null
       left join visits v
         on v.id = vc.visit_id and v.status = 'completed'
      order by c.is_active desc, c.first_name, v.scheduled_for`,
    [TIMEZONE],
  );

  const byCleaner = new Map<string, { meta: Row; visits: Row[] }>();
  for (const r of rows) {
    const entry = byCleaner.get(r.cleaner_id) ?? { meta: r, visits: [] };
    // A row with no visit is a cleaner with nothing outstanding, which the
    // left join produces and which should not read as a job.
    if (r.visit_id) entry.visits.push(r);
    byCleaner.set(r.cleaner_id, entry);
  }
  const cleaners = [...byCleaner.values()];

  const owedTotal = rows.reduce((sum, r) => sum + (r.pay_cents ?? 0), 0);
  // Assigned work with no rate agreed. Surfaced rather than counted as zero,
  // because not knowing what you owe somebody is a problem you want to see.
  const unpriced = rows.filter((r) => r.visit_id && r.pay_cents === null).length;

  return (
    <div className="mx-auto max-w-6xl px-5 py-10">
      <h1 className="mt-6 text-3xl font-semibold text-navy">Cleaner pay</h1>
      <p className="mt-3 max-w-2xl leading-relaxed text-muted">
        Completed visits that have not been paid for yet. Pay by bank transfer,
        then record it here so the same work is not paid twice.
      </p>

      <div className="mt-6 flex flex-wrap gap-3">
        <div className="rounded-xl border border-hairline px-5 py-4">
          <p className="text-xs uppercase tracking-widest text-muted">Outstanding</p>
          <p className="mt-1 text-2xl font-semibold text-navy">{money(owedTotal)}</p>
        </div>
        {unpriced > 0 && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 px-5 py-4">
            <p className="text-xs uppercase tracking-widest text-amber-800">No rate set</p>
            <p className="mt-1 text-2xl font-semibold text-amber-900">{unpriced}</p>
            <p className="mt-1 text-xs text-amber-800">
              Completed visits with nothing to pay against
            </p>
          </div>
        )}
      </div>

      {cleaners.length === 0 ? (
        <p className="mt-10 text-muted">
          Nobody on the roster yet.{" "}
          <Link href="/admin/cleaners" className="font-medium text-accent hover:underline">
            Add a cleaner
          </Link>
          .
        </p>
      ) : (
        <div className="mt-8 space-y-5">
          {cleaners.map(({ meta, visits }) => (
            <CleanerPayCard
              key={meta.cleaner_id}
              cleanerId={meta.cleaner_id}
              name={`${meta.first_name} ${meta.last_name}`}
              email={meta.email}
              isActive={meta.is_active}
              percent={meta.pay_percent_bp === null ? null : meta.pay_percent_bp / 100}
              visits={visits.map((v) => ({
                id: v.visit_id as string,
                onDate: v.on_date as string,
                serviceType: v.service_type as string,
                visitTotalCents: v.visit_total_cents ?? 0,
                payCents: v.pay_cents,
                isLead: v.is_lead ?? false,
              }))}
            />
          ))}
        </div>
      )}
    </div>
  );
}
