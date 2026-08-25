import type { Metadata } from "next";
import Link from "next/link";
import { query } from "@/lib/db";
import { guardAdminPage } from "@/lib/admin-page";
import { TIMEZONE, formatLong } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import {
  subscriptionIncludesFreeAddOn,
  unitSizeLabel,
  type UnitSize,
} from "@/lib/pricing";
import { cadenceLabel } from "@/lib/cadence";
import { FreeAddOnToggle } from "@/components/admin/FreeAddOnToggle";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Members",
  robots: { index: false, follow: false },
};

type MemberRow = {
  subscription_id: string;
  status: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  /** Null on a house, which is quoted on square footage and has no bracket. */
  unit_size: UnitSize | null;
  interval_days: number | null;
  visits_per_period: number;
  free_add_on_override: boolean | null;
  monthly_amount_cents: number;
  pending_amount_cents: number | null;
  pending_amount_effective_on: string | null;
  started_on: string;
  ends_on: string | null;
  line1: string;
  line2: string | null;
  city: string;
  postal_code: string;
  next_visit: string | null;
  visits_used: number | null;
  visits_allotted: number | null;
  free_addon_used: boolean | null;
};

export default async function MembersPage() {
  const guard = await guardAdminPage();
  if (!guard.ok) return guard.node;

  const members = await query<MemberRow>(
    `select s.id as subscription_id, s.status::text as status,
            c.first_name, c.last_name, c.email::text as email, c.phone,
            s.unit_size, s.monthly_amount_cents,
            s.interval_days, s.visits_per_period, s.free_add_on_override,
            s.pending_amount_cents,
            s.pending_amount_effective_on::text as pending_amount_effective_on,
            s.started_on::text as started_on, s.ends_on::text as ends_on,
            p.line1, p.line2, p.city, p.postal_code,
            (select (v.scheduled_for at time zone $1)::date::text
               from visits v
              where v.subscription_id = s.id
                and v.status in ('scheduled', 'assigned')
                and v.scheduled_for >= now()
              order by v.scheduled_for
              limit 1) as next_visit,
            sp.visits_used, sp.visits_allotted, sp.free_addon_used
       from subscriptions s
       join customers c on c.id = s.customer_id
       join properties p on p.id = s.property_id
       left join subscription_periods sp
              on sp.subscription_id = s.id
             and sp.period_start <= (now() at time zone $1)::date
             and sp.period_end   >  (now() at time zone $1)::date
      where s.status in ('active', 'paused', 'pending_cancellation')
      order by c.first_name, c.last_name`,
    [TIMEZONE],
  );

  // What is actually recurring each month. A scheduled rate change counts at
  // its new figure only once it has taken effect, so this matches what Stripe
  // will charge rather than what somebody signed up on.
  const monthly = members.reduce((sum, m) => {
    const live =
      m.pending_amount_cents !== null &&
      m.pending_amount_effective_on !== null &&
      m.pending_amount_effective_on <= new Date().toISOString().slice(0, 10);
    return sum + (live ? m.pending_amount_cents! : m.monthly_amount_cents);
  }, 0);

  const leaving = members.filter((m) => m.status === "pending_cancellation").length;

  return (
    <div className="mx-auto max-w-6xl px-5 py-10">

      <div className="mt-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold text-navy">Members</h1>
          <p className="mt-1 text-muted">
            {members.length} {members.length === 1 ? "membership" : "memberships"}
            {leaving > 0 && `, ${leaving} ending`}
          </p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-semibold text-navy">{formatCents(monthly)}</p>
          <p className="text-sm text-muted">recurring each month</p>
        </div>
      </div>

      {members.length === 0 ? (
        <p className="mt-10 rounded-2xl border border-hairline bg-panel p-8 text-center text-muted">
          No memberships yet.
        </p>
      ) : (
        <ul className="mt-8 space-y-4">
          {members.map((m) => {
            const perkIncluded = subscriptionIncludesFreeAddOn({
              intervalDays: m.interval_days,
              visitsPerPeriod: m.visits_per_period,
              freeAddOnOverride: m.free_add_on_override,
            });
            // Only outstanding if they are owed one. This chip used to appear
            // against every membership with an unclaimed period, including the
            // ones that never had an add-on to claim, so it read as a job to
            // chase that did not exist.
            const perkOutstanding =
              perkIncluded && m.visits_allotted !== null && !m.free_addon_used;

            return (
              <li
                key={m.subscription_id}
                className="rounded-2xl border border-hairline bg-white p-5"
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <h2 className="text-lg font-semibold text-navy">
                      {m.first_name} {m.last_name}
                    </h2>
                    <p className="text-sm text-muted">
                      {m.line1}
                      {m.line2 ? `, ${m.line2}` : ""}, {m.city} {m.postal_code}
                    </p>
                    <p className="mt-1 text-sm text-muted">
                      <a href={`mailto:${m.email}`} className="text-accent underline">
                        {m.email}
                      </a>{" "}
                      ·{" "}
                      <a href={`tel:${m.phone}`} className="text-accent underline">
                        {m.phone}
                      </a>
                    </p>
                  </div>

                  <div className="text-right">
                    <p className="font-semibold text-navy">
                      {formatCents(m.monthly_amount_cents)}
                      <span className="font-normal text-muted"> a month</span>
                    </p>
                    <p className="text-sm text-muted">
                      {m.unit_size ? unitSizeLabel(m.unit_size) : "House"}
                      {m.interval_days != null && `, ${cadenceLabel(m.interval_days)}`}
                    </p>
                    <p className="mt-1 text-xs text-muted">
                      Since {formatLong(m.started_on)}
                    </p>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-hairline pt-4 text-sm">
                  {m.status === "pending_cancellation" && m.ends_on && (
                    <Chip tone="warn">Ends {formatLong(m.ends_on)}</Chip>
                  )}
                  {m.pending_amount_cents !== null && m.pending_amount_effective_on && (
                    <Chip tone="warn">
                      {formatCents(m.pending_amount_cents)} from{" "}
                      {formatLong(m.pending_amount_effective_on)}
                    </Chip>
                  )}
                  {m.visits_allotted !== null && (
                    <Chip>
                      {m.visits_used} of {m.visits_allotted} cleanings this month
                    </Chip>
                  )}
                  {perkOutstanding && <Chip tone="warn">Free add-on unclaimed</Chip>}
                  {m.next_visit ? (
                    <Link
                      href={`/admin?date=${m.next_visit}`}
                      className="text-accent hover:underline"
                    >
                      Next {formatLong(m.next_visit)}
                    </Link>
                  ) : (
                    <Chip tone="warn">Nothing scheduled</Chip>
                  )}
                </div>

                <FreeAddOnToggle
                  subscriptionId={m.subscription_id}
                  override={m.free_add_on_override}
                  effective={perkIncluded}
                />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Chip({
  children,
  tone = "plain",
}: {
  children: React.ReactNode;
  tone?: "plain" | "warn";
}) {
  return (
    <span
      className={`rounded-full px-3 py-1 ${
        tone === "warn" ? "bg-amber-100 text-amber-900" : "bg-panel text-body"
      }`}
    >
      {children}
    </span>
  );
}
