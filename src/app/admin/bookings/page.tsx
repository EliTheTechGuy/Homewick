import type { Metadata } from "next";
import Link from "next/link";
import { query } from "@/lib/db";
import { guardAdminPage } from "@/lib/admin-page";
import { TIMEZONE } from "@/lib/dates";
import { propertyLabel, serviceTypeLabel, type ServiceType, type UnitSize } from "@/lib/pricing";
import { BookingRow, type BookingRowData } from "@/components/admin/BookingRow";
import type { CleanerOption } from "@/components/admin/AssignCrew";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Bookings",
  robots: { index: false, follow: false },
};

/**
 * Every booking, as a list you can work down.
 *
 * The schedule answers "what is happening on this day", which is the wrong
 * question when you are chasing a payment, staffing next week, or trying to
 * find a customer whose date you cannot remember. Before this, an upcoming
 * one-off existed only on the single day it fell on: if you did not know the
 * date, there was no way to reach it at all. History is past-only.
 *
 * Rows open in place. Working a list means opening one, doing a thing, and
 * moving on, and a page load between each of those loses your position every
 * time.
 */

const FILTERS = [
  { key: "upcoming", label: "Upcoming" },
  { key: "needs_cleaner", label: "Needs a cleaner" },
  { key: "unpaid", label: "Unpaid" },
  { key: "past", label: "Past" },
  { key: "all", label: "Everything" },
] as const;

type FilterKey = (typeof FILTERS)[number]["key"];

type Row = {
  id: string;
  on_date: string;
  at_time: string;
  status: string;
  origin: string;
  service_type: ServiceType;
  unit_size: UnitSize | null;
  bedrooms: number | null;
  bathrooms: string | null;
  property_kind: "apartment" | "house";
  has_pets: boolean;
  line1: string;
  line2: string | null;
  city: string;
  postal_code: string;
  property_id: string;
  first_name: string;
  last_name: string;
  phone: string;
  email: string;
  customer_instructions: string | null;
  price_cents: number;
  subscription_id: string | null;
  awaiting_payment: boolean;
  has_entry_details: boolean;
  crew: { cleaner_id: string; name: string; is_lead: boolean; pay_cents: number | null }[] | null;
};

export default async function BookingsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; filter?: string; open?: string }>;
}) {
  const guard = await guardAdminPage();
  if (!guard.ok) return guard.node;

  const params = await searchParams;
  const search = (params.q ?? "").trim();
  const filter: FilterKey = FILTERS.some((f) => f.key === params.filter)
    ? (params.filter as FilterKey)
    : "upcoming";

  const rows = await query<Row>(
    `select v.id,
            (v.scheduled_for at time zone $1)::date::text as on_date,
            to_char(v.scheduled_for at time zone $1, 'HH12:MI AM') as at_time,
            v.status::text as status, v.origin::text as origin, v.service_type,
            p.unit_size, p.bedrooms, p.bathrooms, p.property_kind::text as property_kind,
            p.has_pets, p.line1, p.line2, p.city, p.postal_code, p.id as property_id,
            c.first_name, c.last_name, c.phone, c.email::text as email,
            v.customer_instructions,
            coalesce(
              nullif(v.base_amount_cents + v.pet_surcharge_cents + v.addons_amount_cents, 0),
              s.monthly_amount_cents / greatest(s.visits_per_period, 1)
            ) as price_cents,
            v.subscription_id,
            (v.payment_terms = 'later'
               and case when v.subscription_id is null
                        then v.stripe_payment_intent_id is null
                        else s.stripe_subscription_id is null
                   end) as awaiting_payment,
            exists (select 1 from property_access_secrets pas
                     where pas.property_id = p.id) as has_entry_details,
            (select json_agg(json_build_object(
                       'cleaner_id', vc.cleaner_id,
                       'name', cl.first_name || ' ' || cl.last_name,
                       'is_lead', vc.is_lead,
                       'pay_cents', vc.pay_cents)
                     order by vc.is_lead desc)
               from visit_cleaners vc
               join cleaners cl on cl.id = vc.cleaner_id
              where vc.visit_id = v.id) as crew
       from visits v
       join properties p on p.id = v.property_id
       join customers c on c.id = v.customer_id
       left join subscriptions s on s.id = v.subscription_id
      where
        -- An unpaid booking that nobody has agreed to is a checkout somebody
        -- walked away from. It is not work, and it does not belong on a list
        -- of jobs.
        (v.status <> 'pending_payment')
        and case $2
          when 'upcoming' then v.scheduled_for >= now() and v.status <> 'canceled'
          when 'past'     then v.scheduled_for <  now()
          when 'needs_cleaner' then
            v.scheduled_for >= now() and v.status not in ('canceled', 'completed', 'skipped')
            and not exists (select 1 from visit_cleaners vc where vc.visit_id = v.id)
          when 'unpaid' then
            v.status <> 'canceled' and v.payment_terms = 'later'
            and case when v.subscription_id is null
                     then v.stripe_payment_intent_id is null
                     else s.stripe_subscription_id is null end
          else true
        end
        and (
          $3 = ''
          or c.first_name ilike '%' || $3 || '%'
          or c.last_name ilike '%' || $3 || '%'
          or (c.first_name || ' ' || c.last_name) ilike '%' || $3 || '%'
          or c.email::text ilike '%' || $3 || '%'
          or c.phone ilike '%' || $3 || '%'
          or p.line1 ilike '%' || $3 || '%'
          or p.postal_code ilike '%' || $3 || '%'
        )
      -- Past reads backwards, everything else forwards. Two keys rather than
      -- one expression, because a timestamp cannot be flipped by arithmetic
      -- and trying produced a query that only failed once it hit Postgres.
      order by
        case when $2 = 'past' then v.scheduled_for end desc nulls last,
        case when $2 <> 'past' then v.scheduled_for end asc nulls last
      limit 100`,
    [TIMEZONE, filter, search],
  );

  const cleaners = await query<CleanerOption>(
    `select id, first_name || ' ' || last_name as name
       from cleaners where is_active order by first_name`,
  );

  const bookings: BookingRowData[] = rows.map((r) => ({
    id: r.id,
    onDate: r.on_date,
    atTime: r.at_time,
    status: r.status,
    origin: r.origin,
    serviceLabel: serviceTypeLabel(r.service_type),
    propertyLabel: propertyLabel({
      unitSize: r.unit_size,
      bedrooms: r.bedrooms,
      bathrooms: r.bathrooms,
    }),
    isHouse: r.property_kind === "house",
    hasPets: r.has_pets,
    line1: r.line1,
    line2: r.line2,
    city: r.city,
    postalCode: r.postal_code,
    customerName: `${r.first_name} ${r.last_name}`,
    phone: r.phone,
    email: r.email,
    instructions: r.customer_instructions,
    priceCents: r.price_cents,
    subscriptionId: r.subscription_id,
    propertyId: r.property_id,
    awaitingPayment: r.awaiting_payment,
    hasEntryDetails: r.has_entry_details,
    crew: (r.crew ?? []).map((c) => ({
      cleanerId: c.cleaner_id,
      name: c.name,
      isLead: c.is_lead,
      payCents: c.pay_cents,
    })),
  }));

  const href = (next: Partial<{ q: string; filter: string }>) => {
    const p = new URLSearchParams();
    const q = next.q ?? search;
    const f = next.filter ?? filter;
    if (q) p.set("q", q);
    if (f !== "upcoming") p.set("filter", f);
    const s = p.toString();
    return s ? `/admin/bookings?${s}` : "/admin/bookings";
  };

  return (
    <div className="mx-auto max-w-5xl px-5 py-10">
      <h1 className="mt-6 text-3xl font-semibold text-navy">Bookings</h1>
      <p className="mt-1 text-muted">
        {bookings.length === 100 ? "First 100" : bookings.length}{" "}
        {bookings.length === 1 ? "booking" : "bookings"}
      </p>

      <form method="get" className="mt-6 flex flex-wrap gap-3">
        {filter !== "upcoming" && <input type="hidden" name="filter" value={filter} />}
        <input
          type="search"
          name="q"
          defaultValue={search}
          placeholder="Name, email, phone, address, or ZIP"
          className="min-w-0 flex-1 rounded-xl border border-hairline bg-white px-4 py-3 text-body"
        />
        <button
          type="submit"
          className="rounded-full bg-accent px-6 py-3 text-sm font-semibold text-white"
        >
          Search
        </button>
      </form>

      <div className="mt-4 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Link
            key={f.key}
            href={href({ filter: f.key })}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
              filter === f.key
                ? "bg-navy text-white"
                : "border border-hairline text-muted hover:text-navy"
            }`}
          >
            {f.label}
          </Link>
        ))}
      </div>

      {bookings.length === 0 ? (
        <p className="mt-10 rounded-2xl border border-hairline bg-panel p-8 text-center text-muted">
          {search ? `Nothing matching "${search}".` : "Nothing here."}
        </p>
      ) : (
        <ul className="mt-6 space-y-3">
          {bookings.map((b) => (
            <BookingRow
              key={b.id}
              booking={b}
              cleaners={cleaners}
              defaultOpen={params.open === b.id}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
