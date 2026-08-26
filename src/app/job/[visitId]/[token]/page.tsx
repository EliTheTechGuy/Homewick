import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { queryOne } from "@/lib/db";
import { TIMEZONE, formatLong } from "@/lib/dates";
import { visitTokenValid } from "@/lib/visit-links";
import { propertyLabel, serviceTypeLabel, type ServiceType, type UnitSize } from "@/lib/pricing";
import { JobAccess } from "@/components/JobAccess";
import { JobChecklist } from "@/components/JobChecklist";
import { checklistFor } from "@/lib/checklists";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Your job",
  robots: { index: false, follow: false },
};

/**
 * One job, for the cleaner doing it.
 *
 * Deliberately outside the (site) group: this is a working screen on somebody
 * else's phone at a front door, not a page of the marketing site, and it
 * should not carry a nav bar inviting them to browse pricing.
 *
 * Everything here is safe to sit in a link. The entry code is not, so it is
 * behind a button that only works on the day and writes an audit row.
 */
export default async function JobPage({
  params,
}: PageProps<"/job/[visitId]/[token]">) {
  const { visitId, token } = await params;
  if (!visitTokenValid(visitId, token)) notFound();

  const visit = await queryOne<{
    status: string;
    on_date: string;
    at_time: string;
    service_type: ServiceType;
    unit_size: UnitSize | null;
    bedrooms: number | null;
    bathrooms: string | null;
    has_pets: boolean;
    line1: string;
    line2: string | null;
    city: string;
    postal_code: string;
    customer_first: string;
    customer_last: string;
    customer_phone: string;
    customer_instructions: string | null;
    add_ons: string[] | null;
    is_today: boolean;
    has_entry_details: boolean;
  }>(
    `select v.status::text as status,
            (v.scheduled_for at time zone $2)::date::text as on_date,
            to_char(v.scheduled_for at time zone $2, 'HH12:MI AM') as at_time,
            v.service_type, p.unit_size, p.bedrooms, p.bathrooms, p.has_pets,
            p.line1, p.line2, p.city, p.postal_code,
            c.first_name as customer_first, c.last_name as customer_last,
            c.phone as customer_phone, v.customer_instructions,
            (select array_agg(a.name order by a.sort_order)
               from visit_add_ons va join add_ons a on a.id = va.add_on_id
              where va.visit_id = v.id) as add_ons,
            (v.scheduled_for at time zone $2)::date = (now() at time zone $2)::date
              as is_today,
            exists (select 1 from property_access_secrets s where s.property_id = p.id)
              as has_entry_details
       from visits v
       join customers c on c.id = v.customer_id
       join properties p on p.id = v.property_id
      where v.id = $1`,
    [visitId, TIMEZONE],
  );

  if (!visit) notFound();

  const address = [visit.line1, visit.line2, `${visit.city}, TX ${visit.postal_code}`]
    .filter(Boolean)
    .join(", ");

  const cancelled = visit.status === "canceled";

  return (
    <div className="mx-auto max-w-xl px-5 py-10">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted">
        Homewick job
      </p>
      <h1 className="mt-2 text-3xl font-semibold text-navy">
        {formatLong(visit.on_date)}
      </h1>
      <p className="mt-1 text-lg text-body">{visit.at_time}</p>

      {cancelled && (
        <p className="mt-6 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800">
          This job has been cancelled. Please do not attend.
        </p>
      )}

      <dl className="mt-8 divide-y divide-hairline border-y border-hairline">
        <Row label="Address" value={address} />
        {/* A house has no bracket, and "Apartment:" with nothing after it
            is what a cleaner heading to a four bedroom house was reading. */}
        <Row
          label="Property"
          value={propertyLabel({
            unitSize: visit.unit_size,
            bedrooms: visit.bedrooms,
            bathrooms: visit.bathrooms,
          })}
        />
        <Row label="Job" value={serviceTypeLabel(visit.service_type)} />
        <Row
          label="Customer"
          value={`${visit.customer_first} ${visit.customer_last}`}
        />
        <Row label="Phone" value={visit.customer_phone} href={`tel:${visit.customer_phone}`} />
        {visit.has_pets && <Row label="Pets" value="Yes, at this address" />}
        {visit.add_ons && visit.add_ons.length > 0 && (
          <Row label="Also included" value={visit.add_ons.join(", ")} />
        )}
      </dl>

      {!cancelled && <JobChecklist sections={checklistFor(visit.service_type)} />}

      {visit.customer_instructions && (
        <div className="mt-6 rounded-xl bg-panel p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">
            The customer asked
          </p>
          <p className="mt-2 leading-relaxed text-body">
            {visit.customer_instructions}
          </p>
        </div>
      )}

      {!cancelled && visit.has_entry_details && (
        <div className="mt-8">
          <JobAccess
            visitId={visitId}
            token={token}
            unlocked={visit.is_today}
          />
        </div>
      )}

      {!cancelled && !visit.has_entry_details && (
        <p className="mt-8 text-sm leading-relaxed text-muted">
          There are no entry details on file for this one, so expect to be let in.
        </p>
      )}

      <p className="mt-10 text-sm leading-relaxed text-muted">
        Keep this link to yourself. It opens this job and, on the day, its entry
        details.
      </p>
    </div>
  );
}

function Row({
  label,
  value,
  href,
}: {
  label: string;
  value: string;
  href?: string;
}) {
  return (
    <div className="flex flex-wrap justify-between gap-x-6 gap-y-1 py-3">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="text-right font-medium text-body">
        {href ? (
          <a href={href} className="text-accent underline">
            {value}
          </a>
        ) : (
          value
        )}
      </dd>
    </div>
  );
}
