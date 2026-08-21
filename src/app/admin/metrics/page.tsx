import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/admin-auth";
import { loadMetrics, revenueByMonth } from "@/lib/metrics";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Metrics",
  robots: { index: false, follow: false },
};

function money(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function Stat({
  label,
  value,
  note,
  tone = "plain",
}: {
  label: string;
  value: string;
  note?: string;
  tone?: "plain" | "warn";
}) {
  const warn = tone === "warn";
  return (
    <div
      className={
        warn
          ? "rounded-2xl border border-amber-300 bg-amber-50 p-5"
          : "rounded-2xl border border-hairline p-5"
      }
    >
      <p
        className={`text-xs uppercase tracking-widest ${warn ? "text-amber-800" : "text-muted"}`}
      >
        {label}
      </p>
      <p
        className={`mt-1 text-3xl font-semibold ${warn ? "text-amber-900" : "text-navy"}`}
      >
        {value}
      </p>
      {note && (
        <p className={`mt-1 text-xs ${warn ? "text-amber-800" : "text-muted"}`}>{note}</p>
      )}
    </div>
  );
}

/**
 * The numbers that change a decision, and deliberately not the ones that only
 * look impressive.
 *
 * Money counts completed work only. A booking awaiting payment is a hope, and
 * a dashboard that counts hopes as revenue is one you stop trusting the first
 * time somebody abandons a checkout.
 *
 * Anything needing a person is amber rather than buried in a list. An
 * unanswered quote and an unassigned visit next week are both work about to go
 * wrong, and finding those is the reason to open this page at all.
 */
export default async function MetricsPage() {
  const admin = await requireAdmin();
  if (!admin) return null;

  const [m, months] = await Promise.all([loadMetrics(), revenueByMonth()]);

  const kept = m.revenue.thisMonthCents - m.revenue.crewCostCents;
  const marginPct =
    m.revenue.thisMonthCents > 0
      ? Math.round((kept / m.revenue.thisMonthCents) * 100)
      : null;

  const change =
    m.revenue.lastMonthCents > 0
      ? Math.round(
          ((m.revenue.thisMonthCents - m.revenue.lastMonthCents) /
            m.revenue.lastMonthCents) *
            100,
        )
      : null;

  const peak = Math.max(1, ...months.map((x) => x.cents));

  return (
    <div className="mx-auto max-w-6xl px-5 py-10">
      <h1 className="mt-6 text-3xl font-semibold text-navy">Metrics</h1>
      <p className="mt-3 max-w-2xl leading-relaxed text-muted">
        Completed work only. Anything still waiting to be paid for is not counted
        here, so these are earnings rather than expectations.
      </p>

      <h2 className="mt-10 text-lg font-semibold text-navy">Money this month</h2>
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Revenue"
          value={money(m.revenue.thisMonthCents)}
          note={
            change === null
              ? "nothing last month to compare"
              : `${change >= 0 ? "up" : "down"} ${Math.abs(change)}% on last month`
          }
        />
        <Stat
          label="Paid to crews"
          value={money(m.revenue.crewCostCents)}
          note="for work completed this month"
        />
        <Stat
          label="You keep"
          value={money(kept)}
          note={
            marginPct === null ? "before other costs" : `${marginPct}% before other costs`
          }
        />
        <Stat
          label="One-off / recurring"
          value={`${money(m.revenue.oneOffCents)} · ${money(m.revenue.recurringCents)}`}
        />
      </div>

      {months.length > 1 && (
        <div className="mt-6 rounded-2xl border border-hairline p-5">
          <p className="text-xs uppercase tracking-widest text-muted">Last few months</p>
          <div className="mt-4 flex items-end gap-3">
            {months.map((x) => (
              <div key={x.month} className="flex flex-1 flex-col items-center gap-2">
                <span className="text-xs text-muted">{money(x.cents)}</span>
                <div
                  className="w-full rounded-t bg-accent"
                  style={{ height: `${Math.max(4, (x.cents / peak) * 120)}px` }}
                />
                <span className="text-xs text-muted">{x.month}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <h2 className="mt-10 text-lg font-semibold text-navy">Recurring</h2>
      <p className="mt-1 text-sm text-muted">
        What next month looks like before it arrives.
      </p>
      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <Stat
          label="Active"
          value={String(m.recurring.active)}
          note="members and repeat houses"
        />
        <Stat
          label="Worth per month"
          value={money(m.recurring.monthlyValueCents)}
          note="every cadence normalised to a month"
        />
        <Stat
          label="Ending soon"
          value={String(m.recurring.endingSoon)}
          note="cancelled but still running"
          tone={m.recurring.endingSoon > 0 ? "warn" : "plain"}
        />
      </div>

      <h2 className="mt-10 text-lg font-semibold text-navy">Quote requests</h2>
      <div className="mt-4 grid gap-4 sm:grid-cols-4">
        <Stat
          label="Waiting on you"
          value={String(m.leads.open)}
          tone={m.leads.open > 0 ? "warn" : "plain"}
        />
        <Stat
          label="Longest wait"
          value={m.leads.oldestOpenDays === null ? "none" : `${m.leads.oldestOpenDays}d`}
          note="oldest unanswered"
          tone={(m.leads.oldestOpenDays ?? 0) >= 2 ? "warn" : "plain"}
        />
        <Stat label="Received" value={String(m.leads.thisMonth)} note="this month" />
        <Stat label="Won" value={String(m.leads.wonThisMonth)} note="this month" />
      </div>

      <h2 className="mt-10 text-lg font-semibold text-navy">Work</h2>
      <div className="mt-4 grid gap-4 sm:grid-cols-4">
        <Stat
          label="Completed"
          value={String(m.work.completedThisMonth)}
          note="this month"
        />
        <Stat label="Upcoming" value={String(m.work.upcoming)} note="scheduled ahead" />
        <Stat
          label="Unassigned"
          value={String(m.work.unassigned)}
          note="within 14 days, nobody on it"
          tone={m.work.unassigned > 0 ? "warn" : "plain"}
        />
        <Stat
          label="Overdue"
          value={String(m.work.overdue)}
          note="date passed, not marked done"
          tone={m.work.overdue > 0 ? "warn" : "plain"}
        />
      </div>

      <h2 className="mt-10 text-lg font-semibold text-navy">Owed to cleaners</h2>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Stat
          label="Outstanding"
          value={money(m.owed.totalCents)}
          note={`across ${m.owed.cleaners} ${m.owed.cleaners === 1 ? "person" : "people"}`}
          tone={m.owed.totalCents > 0 ? "warn" : "plain"}
        />
        <div className="flex items-center rounded-2xl border border-hairline p-5">
          <p className="text-sm leading-relaxed text-muted">
            Settle these on the{" "}
            <Link href="/admin/pay" className="font-medium text-accent hover:underline">
              Pay
            </Link>{" "}
            tab, which shows who is owed what and for which jobs.
          </p>
        </div>
      </div>
    </div>
  );
}
