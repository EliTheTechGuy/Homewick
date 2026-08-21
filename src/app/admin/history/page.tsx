import type { Metadata } from "next";
import Link from "next/link";
import { query } from "@/lib/db";
import { guardAdminPage } from "@/lib/admin-page";
import { TIMEZONE, formatLong } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { unitSizeLabel, type UnitSize } from "@/lib/pricing";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "History",
  robots: { index: false, follow: false },
};

const PAGE_SIZE = 40;

/**
 * Done jobs live here rather than behind their own tab.
 *
 * A separate "completed" screen would be the same list with one filter
 * pre-applied, and the question actually being asked is almost never "show me
 * everything ever finished". It is "what did we do for this person, and what
 * did they pay", which is a search.
 */
const FILTERS = [
  { key: "all", label: "Everything" },
  { key: "completed", label: "Completed" },
  { key: "skipped", label: "Could not get in" },
  { key: "canceled", label: "Cancelled" },
] as const;

type FilterKey = (typeof FILTERS)[number]["key"];

type HistoryRow = {
  id: string;
  on_date: string;
  at_time: string;
  status: string;
  origin: string;
  service_type: string;
  unit_size: UnitSize;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  line1: string;
  line2: string | null;
  city: string;
  postal_code: string;
  base_amount_cents: number;
  pet_surcharge_cents: number;
  addons_amount_cents: number;
  cleaner_name: string | null;
  add_ons: { name: string; is_free_perk: boolean }[] | null;
};

export default async function HistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; page?: string }>;
}) {
  const guard = await guardAdminPage();
  if (!guard.ok) return guard.node;

  const params = await searchParams;
  const search = (params.q ?? "").trim();
  const status: FilterKey = FILTERS.some((f) => f.key === params.status)
    ? (params.status as FilterKey)
    : "all";
  const page = Math.max(1, Number(params.page) || 1);

  // Past work only. Anything still to come belongs on the schedule, and
  // mixing them makes "what did we do" impossible to read.
  const rows = await query<HistoryRow>(
    `select v.id,
            (v.scheduled_for at time zone $1)::date::text as on_date,
            to_char(v.scheduled_for at time zone $1, 'HH12:MI AM') as at_time,
            v.status::text as status, v.origin::text as origin,
            v.service_type::text as service_type, p.unit_size,
            c.first_name, c.last_name, c.email::text as email, c.phone,
            p.line1, p.line2, p.city, p.postal_code,
            v.base_amount_cents, v.pet_surcharge_cents, v.addons_amount_cents,
            cl.first_name || ' ' || cl.last_name as cleaner_name,
            (select json_agg(json_build_object('name', a.name,
                                               'is_free_perk', va.is_free_perk)
                             order by a.sort_order)
               from visit_add_ons va
               join add_ons a on a.id = va.add_on_id
              where va.visit_id = v.id) as add_ons
       from visits v
       join customers c on c.id = v.customer_id
       join properties p on p.id = v.property_id
       left join cleaners cl on cl.id = v.assigned_cleaner_id
      where v.scheduled_for < now()
        and ($2 = 'all' or v.status::text = $2)
        and (
          $3 = ''
          or c.first_name ilike '%' || $3 || '%'
          or c.last_name  ilike '%' || $3 || '%'
          or (c.first_name || ' ' || c.last_name) ilike '%' || $3 || '%'
          or c.email::text ilike '%' || $3 || '%'
          or c.phone ilike '%' || $3 || '%'
          or p.line1 ilike '%' || $3 || '%'
          or p.postal_code ilike '%' || $3 || '%'
        )
      order by v.scheduled_for desc
      limit $4 offset $5`,
    [TIMEZONE, status, search, PAGE_SIZE + 1, (page - 1) * PAGE_SIZE],
  );

  const hasMore = rows.length > PAGE_SIZE;
  const visits = hasMore ? rows.slice(0, PAGE_SIZE) : rows;

  const takings = visits
    .filter((v) => v.status === "completed")
    .reduce(
      (sum, v) => sum + v.base_amount_cents + v.pet_surcharge_cents + v.addons_amount_cents,
      0,
    );

  const qs = (over: Record<string, string | number>) => {
    const next = new URLSearchParams();
    if (search) next.set("q", search);
    if (status !== "all") next.set("status", status);
    for (const [k, v] of Object.entries(over)) {
      if (v === "" || v === "all") next.delete(k);
      else next.set(k, String(v));
    }
    const s = next.toString();
    return s ? `/admin/history?${s}` : "/admin/history";
  };

  return (
    <div className="mx-auto max-w-6xl px-5 py-10">

      <h1 className="mt-6 text-3xl font-semibold text-navy">History</h1>
      <p className="mt-1 text-muted">
        Every clean that has already happened, and what it was worth.
      </p>

      {/* A plain GET form, so a search can be bookmarked and the back button works. */}
      <form method="get" className="mt-6 flex flex-wrap gap-2">
        <input
          type="search"
          name="q"
          defaultValue={search}
          placeholder="Name, email, phone, address or ZIP"
          aria-label="Search past cleanings"
          className="min-w-0 flex-1 rounded-xl border border-hairline bg-white px-4 py-2.5 text-body"
        />
        {status !== "all" && <input type="hidden" name="status" value={status} />}
        <button
          type="submit"
          className="rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-accent-dark"
        >
          Search
        </button>
        {search && (
          <Link
            href={qs({ q: "", page: 1 })}
            className="rounded-full border border-hairline px-5 py-2.5 text-sm font-semibold text-body"
          >
            Clear
          </Link>
        )}
      </form>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Filter by outcome" className="flex flex-wrap gap-1">
          {FILTERS.map((f) => (
            <Link
              key={f.key}
              href={qs({ status: f.key, page: 1 })}
              aria-current={f.key === status ? "page" : undefined}
              className={
                f.key === status
                  ? "rounded-full bg-navy px-4 py-1.5 text-sm font-semibold text-white"
                  : "rounded-full px-4 py-1.5 text-sm font-medium text-muted hover:bg-panel hover:text-body"
              }
            >
              {f.label}
            </Link>
          ))}
        </nav>

        {takings > 0 && (
          <p className="text-sm text-muted">
            <span className="font-semibold text-navy">{formatCents(takings)}</span> from
            completed cleans on this page
          </p>
        )}
      </div>

      {visits.length === 0 ? (
        <p className="mt-10 rounded-2xl border border-hairline bg-panel p-8 text-center text-muted">
          {search
            ? `Nothing matching "${search}".`
            : "No past cleanings yet."}
        </p>
      ) : (
        <ul className="mt-6 space-y-3">
          {visits.map((v) => {
            const total =
              v.base_amount_cents + v.pet_surcharge_cents + v.addons_amount_cents;
            const paid = v.add_ons?.filter((a) => !a.is_free_perk) ?? [];
            const free = v.add_ons?.filter((a) => a.is_free_perk) ?? [];

            return (
              <li key={v.id} className="rounded-2xl border border-hairline bg-white p-5">
                <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/admin?date=${v.on_date}`}
                        className="font-semibold text-navy hover:underline"
                      >
                        {formatLong(v.on_date)}
                      </Link>
                      <span className="text-sm text-muted">{v.at_time}</span>
                      <Outcome status={v.status} />
                    </div>

                    <p className="mt-1 font-medium text-body">
                      {v.first_name} {v.last_name}
                    </p>
                    <p className="text-sm text-muted">
                      {v.line1}
                      {v.line2 ? `, ${v.line2}` : ""}, {v.city} {v.postal_code}
                    </p>
                    <p className="mt-1 text-sm text-muted">
                      {serviceLabel(v.service_type)} · {unitSizeLabel(v.unit_size)} ·{" "}
                      {v.origin === "membership" ? "Membership" : "One-time"} ·{" "}
                      {v.cleaner_name ?? "nobody assigned"}
                    </p>

                    {(paid.length > 0 || free.length > 0) && (
                      <p className="mt-2 text-sm text-muted">
                        Add-ons:{" "}
                        {[...paid.map((a) => a.name), ...free.map((a) => `${a.name} (free)`)].join(
                          ", ",
                        )}
                      </p>
                    )}
                  </div>

                  <div className="text-right">
                    <p className="text-lg font-semibold text-navy">{formatCents(total)}</p>
                    {v.pet_surcharge_cents > 0 && (
                      <p className="text-xs text-muted">
                        includes {formatCents(v.pet_surcharge_cents)} pets
                      </p>
                    )}
                    {v.addons_amount_cents > 0 && (
                      <p className="text-xs text-muted">
                        includes {formatCents(v.addons_amount_cents)} add-ons
                      </p>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {(page > 1 || hasMore) && (
        <div className="mt-8 flex items-center justify-between">
          {page > 1 ? (
            <Link href={qs({ page: page - 1 })} className="text-accent hover:underline">
              ‹ Newer
            </Link>
          ) : (
            <span />
          )}
          <span className="text-sm text-muted">Page {page}</span>
          {hasMore ? (
            <Link href={qs({ page: page + 1 })} className="text-accent hover:underline">
              Older ›
            </Link>
          ) : (
            <span />
          )}
        </div>
      )}
    </div>
  );
}

function serviceLabel(type: string): string {
  return type === "move_out" ? "Move-out" : type === "deep" ? "Deep" : "Standard";
}

function Outcome({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string }> = {
    completed: { label: "Completed", className: "bg-emerald-100 text-emerald-900" },
    skipped: { label: "Could not get in", className: "bg-amber-100 text-amber-900" },
    canceled: { label: "Cancelled", className: "bg-panel text-muted" },
    scheduled: { label: "Never marked done", className: "bg-red-50 text-red-800" },
    assigned: { label: "Never marked done", className: "bg-red-50 text-red-800" },
  };
  const tone = map[status] ?? { label: status, className: "bg-panel text-body" };

  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${tone.className}`}>
      {tone.label}
    </span>
  );
}
