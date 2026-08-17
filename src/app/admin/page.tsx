import type { Metadata } from "next";
import { query, isDatabaseConfigured } from "@/lib/db";
import { guardAdminPage } from "@/lib/admin-page";
import { TIMEZONE, formatLong, today } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { unitSizeLabel, type UnitSize } from "@/lib/pricing";
import { RevealAccess } from "@/components/RevealAccess";
import { MarkComplete } from "@/components/MarkComplete";
import { MarkSkipped } from "@/components/MarkSkipped";
import { AssignCleaner, type CleanerOption } from "@/components/admin/AssignCleaner";
import { AdminNav } from "@/components/admin/AdminNav";
import { MonthCalendar, type DayCount } from "@/components/admin/MonthCalendar";
import { UpcomingRail, type UpcomingRow } from "@/components/admin/UpcomingRail";
import { addDays, addMonths, isISODate } from "@/lib/dates";

export const metadata: Metadata = { title: "Schedule", robots: { index: false } };
export const dynamic = "force-dynamic";

type VisitRow = {
  id: string;
  property_id: string;
  scheduled_at: string;
  status: string;
  origin: string;
  service_type: string;
  unit_size: UnitSize;
  has_pets: boolean;
  line1: string;
  line2: string | null;
  city: string;
  postal_code: string;
  first_name: string;
  last_name: string;
  phone: string;
  customer_instructions: string | null;
  base_amount_cents: number;
  pet_surcharge_cents: number;
  addons_amount_cents: number;
  add_ons: { name: string; is_free_perk: boolean }[] | null;
  cleaner_name: string | null;
  assigned_cleaner_id: string | null;
  moved_from: string | null;
};

export default async function AdminTodayPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const guard = await guardAdminPage();
  if (!guard.ok) return guard.node;

  const { date } = await searchParams;
  // A hand-edited or stale date must not reach Postgres as a cast, which would
  // throw and render an unstyled crash rather than a working screen.
  const day = date && isISODate(date) ? date : today();

  const visits = await query<VisitRow>(
    `select v.id, v.property_id, v.status::text as status, v.origin::text as origin,
            v.service_type::text as service_type,
            to_char(v.scheduled_for at time zone $2, 'HH12:MI AM') as scheduled_at,
            v.customer_instructions, v.base_amount_cents, v.pet_surcharge_cents,
            v.addons_amount_cents,
            p.unit_size, p.has_pets, p.line1, p.line2, p.city, p.postal_code,
            c.first_name, c.last_name, c.phone,
            cl.first_name || ' ' || cl.last_name as cleaner_name,
            v.assigned_cleaner_id,
            (v.rescheduled_from at time zone $2)::date::text as moved_from,
            (select json_agg(json_build_object('name', a.name,
                                               'is_free_perk', va.is_free_perk)
                             order by a.sort_order)
               from visit_add_ons va
               join add_ons a on a.id = va.add_on_id
              where va.visit_id = v.id) as add_ons
       from visits v
       join properties p on p.id = v.property_id
       join customers c on c.id = v.customer_id
       left join cleaners cl on cl.id = v.assigned_cleaner_id
      where (v.scheduled_for at time zone $2)::date = $1::date
        and v.status not in ('canceled', 'pending_payment')
      order by v.scheduled_for`,
    [day, TIMEZONE],
  );

  // The roster is loaded once here rather than per visit, so the assign
  // control on every card shares one query.
  const roster = await query<{ id: string; name: string }>(
    `select id, first_name || ' ' || last_name as name
       from cleaners
      where is_active = true
      order by first_name, last_name`,
  );
  const cleaners: CleanerOption[] = roster;

  // One row per day of the visible month, so the calendar can show how much
  // work each day carries and which days still need somebody on them.
  const monthStart = `${day.slice(0, 7)}-01`;
  const monthEnd = addMonths(monthStart, 1);
  const counts = await query<DayCount>(
    `select (v.scheduled_for at time zone $3)::date::text as on_date,
            count(*)::int as total,
            count(*) filter (where v.assigned_cleaner_id is null)::int as unassigned
       from visits v
      where (v.scheduled_for at time zone $3)::date >= $1::date
        and (v.scheduled_for at time zone $3)::date <  $2::date
        and v.status not in ('canceled', 'pending_payment')
      group by 1`,
    [monthStart, monthEnd, TIMEZONE],
  );

  // Deliberately anchored to today rather than to the selected day: this
  // answers "what is next", which does not change because somebody clicked
  // back to last Tuesday.
  const from = today();
  const upcoming = await query<UpcomingRow>(
    `select v.id,
            (v.scheduled_for at time zone $2)::date::text as on_date,
            to_char(v.scheduled_for at time zone $2, 'HH12:MI AM') as at_time,
            c.first_name, c.last_name, p.line1,
            cl.first_name || ' ' || cl.last_name as cleaner_name
       from visits v
       join customers c on c.id = v.customer_id
       join properties p on p.id = v.property_id
       left join cleaners cl on cl.id = v.assigned_cleaner_id
      where (v.scheduled_for at time zone $2)::date >= $1::date
        and v.status in ('scheduled', 'assigned')
      order by v.scheduled_for
      limit 12`,
    [from, TIMEZONE],
  );

  return (
    <div className="mx-auto max-w-[1400px] px-5 py-10">
      <AdminNav current="day" />

      <div className="mt-6 grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)] xl:grid-cols-[280px_minmax(0,1fr)_300px]">
        {/* Calendar. Sticky on wide screens so it stays put while a long day scrolls. */}
        <div className="lg:sticky lg:top-6 lg:self-start">
          <MonthCalendar month={day} selected={day} today={from} counts={counts} />
          {day !== from && (
            <a
              href={`/admin?date=${from}`}
              className="mt-3 block text-center text-sm font-medium text-accent hover:underline"
            >
              Back to today
            </a>
          )}
        </div>

        {/* The selected day. */}
        <div className="min-w-0">
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold text-navy">{formatLong(day)}</h1>
          <p className="mt-1 text-muted">
            {day === from ? "Today" : day === addDays(from, 1) ? "Tomorrow" : "Selected day"}
          </p>
        </div>
        <p className="text-sm text-muted">
          {visits.length} {visits.length === 1 ? "visit" : "visits"}
        </p>
      </div>

      {visits.length === 0 ? (
        <p className="mt-8 rounded-2xl border border-hairline bg-panel p-8 text-center text-muted">
          Nothing scheduled on this day.
        </p>
      ) : (
        <ul className="mt-6 space-y-5">
          {visits.map((visit) => (
            <li
              key={visit.id}
              className="rounded-2xl border border-hairline bg-white p-6"
            >
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold tracking-wide text-accent">
                    {visit.scheduled_at}
                  </p>
                  <h2 className="mt-1 text-xl font-semibold text-navy">
                    {visit.line1}
                    {visit.line2 ? `, ${visit.line2}` : ""}
                  </h2>
                  <p className="text-muted">
                    {visit.city}, TX {visit.postal_code}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-medium text-navy">
                    {visit.first_name} {visit.last_name}
                  </p>
                  <a href={`tel:${visit.phone}`} className="text-sm text-accent">
                    {visit.phone}
                  </a>
                </div>
              </div>

              <div className="mt-5 flex flex-wrap gap-2">
                <Tag>{unitSizeLabel(visit.unit_size)}</Tag>
                <Tag>{serviceLabel(visit.service_type)}</Tag>
                <Tag>{visit.origin === "membership" ? "Membership" : "One-time"}</Tag>
                {/* The surcharge is one-time and usually zero by now, so the
                    cleaner just needs to know there are animals in the home. */}
                {visit.moved_from && <Tag tone="warn">Moved from {formatLong(visit.moved_from)}</Tag>}
                {visit.has_pets && <Tag tone="warn">Pets</Tag>}
                <Tag tone={visit.status === "completed" ? "good" : "plain"}>
                  {visit.status}
                </Tag>
              </div>

              {visit.add_ons && visit.add_ons.length > 0 && (
                <div className="mt-5">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted">
                    Add-ons
                  </p>
                  <ul className="mt-2 flex flex-wrap gap-2">
                    {visit.add_ons.map((a) => (
                      <li
                        key={a.name}
                        className={`rounded-full px-3 py-1 text-sm ${
                          a.is_free_perk
                            ? "bg-accent text-white"
                            : "bg-panel text-body"
                        }`}
                      >
                        {a.name}
                        {a.is_free_perk && " · free perk"}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {visit.customer_instructions && (
                <div className="mt-5 rounded-xl bg-panel p-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted">
                    Customer instructions
                  </p>
                  <p className="mt-1 leading-relaxed text-body">
                    {visit.customer_instructions}
                  </p>
                </div>
              )}

              <div className="mt-5 flex flex-wrap items-center justify-between gap-4 border-t border-hairline pt-4">
                <div className="flex flex-wrap items-center gap-3">
                  <RevealAccess visitId={visit.id} propertyId={visit.property_id} />
                  {visit.status !== "completed" && visit.status !== "skipped" && (
                    <>
                      <MarkComplete visitId={visit.id} />
                      <MarkSkipped visitId={visit.id} />
                    </>
                  )}
                </div>
                <AssignCleaner
                  visitId={visit.id}
                  assignedId={visit.assigned_cleaner_id}
                  cleaners={cleaners}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
        </div>

        {/* What is next, independent of which day is selected. */}
        <div className="xl:sticky xl:top-6 xl:self-start">
          <UpcomingRail rows={upcoming} from={from} />
        </div>
      </div>
    </div>
  );
}

function serviceLabel(type: string): string {
  return type === "move_out" ? "Move-out" : type === "deep" ? "Deep" : "Standard";
}

function Tag({
  children,
  tone = "plain",
}: {
  children: React.ReactNode;
  tone?: "plain" | "warn" | "good";
}) {
  const styles = {
    plain: "bg-panel text-body",
    warn: "bg-amber-100 text-amber-900",
    good: "bg-emerald-100 text-emerald-900",
  }[tone];
  return (
    <span className={`rounded-full px-3 py-1 text-sm capitalize ${styles}`}>{children}</span>
  );
}

function Notice({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-xl px-5 py-24 text-center">
      <h1 className="text-2xl font-semibold text-navy">{title}</h1>
      <p className="mt-3 text-muted">{children}</p>
    </div>
  );
}
