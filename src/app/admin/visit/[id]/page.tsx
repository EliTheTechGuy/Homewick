import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { query, queryOne } from "@/lib/db";
import { guardAdminPage } from "@/lib/admin-page";
import { TIMEZONE, formatLong } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { propertyLabel, serviceTypeLabel, type ServiceType, type UnitSize } from "@/lib/pricing";
import { checklistFor } from "@/lib/checklists";
import { visitToken } from "@/lib/visit-links";
import { AssignCrew, type CleanerOption } from "@/components/admin/AssignCrew";
import { SendPaymentLink } from "@/components/admin/SendPaymentLink";
import { CancelVisitAdmin } from "@/components/admin/CancelVisitAdmin";
import { MarkComplete } from "@/components/MarkComplete";
import { MarkSkipped } from "@/components/MarkSkipped";
import { RevealAccess } from "@/components/RevealAccess";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Cleaning",
  robots: { index: false, follow: false },
};

/**
 * One cleaning, everything about it, in one place.
 *
 * The day board answers "what is happening today". It was also the only way
 * to reach a job at all, which made everything else about a single cleaning
 * either cramped onto a card or missing: no crew detail, no way to see what
 * each person is owed, nowhere to send a payment link from unless the job
 * happened to be on the day you were looking at.
 */
export default async function AdminVisitPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const guard = await guardAdminPage();
  if (!guard.ok) return guard.node;

  const { id } = await params;

  const visit = await queryOne<{
    id: string;
    status: string;
    origin: string;
    service_type: ServiceType;
    on_date: string;
    at_time: string;
    unit_size: UnitSize | null;
    bedrooms: number | null;
    bathrooms: string | null;
    property_kind: "apartment" | "house";
    has_pets: boolean;
    line1: string;
    line2: string | null;
    city: string;
    postal_code: string;
    first_name: string;
    last_name: string;
    phone: string;
    email: string;
    customer_instructions: string | null;
    price_cents: number;
    subscription_id: string | null;
    awaiting_payment: boolean;
    has_entry_details: boolean;
    property_id: string;
  }>(
    `select v.id, v.status::text as status, v.origin::text as origin, v.service_type,
            (v.scheduled_for at time zone $2)::date::text as on_date,
            to_char(v.scheduled_for at time zone $2, 'HH12:MI AM') as at_time,
            p.unit_size, p.bedrooms, p.bathrooms,
            p.property_kind::text as property_kind, p.has_pets,
            p.line1, p.line2, p.city, p.postal_code,
            c.first_name, c.last_name, c.phone, c.email::text as email,
            v.customer_instructions,
            coalesce(
              nullif(v.base_amount_cents + v.pet_surcharge_cents + v.addons_amount_cents, 0),
              s.monthly_amount_cents / greatest(s.visits_per_period, 1)
            ) as price_cents,
            v.subscription_id, p.id as property_id,
            (v.payment_terms = 'later'
               and case when v.subscription_id is null
                        then v.stripe_payment_intent_id is null
                        else s.stripe_subscription_id is null
                   end) as awaiting_payment,
            exists (select 1 from property_access_secrets pas
                     where pas.property_id = p.id) as has_entry_details
       from visits v
       join properties p on p.id = v.property_id
       join customers c on c.id = v.customer_id
       left join subscriptions s on s.id = v.subscription_id
      where v.id = $1`,
    [id, TIMEZONE],
  );
  if (!visit) notFound();

  const crew = await query<{
    cleaner_id: string;
    is_lead: boolean;
    pay_cents: number | null;
    paid_at: string | null;
    name: string;
  }>(
    `select vc.cleaner_id, vc.is_lead, vc.pay_cents, vc.paid_at::text as paid_at,
            cl.first_name || ' ' || cl.last_name as name
       from visit_cleaners vc
       join cleaners cl on cl.id = vc.cleaner_id
      where vc.visit_id = $1
      order by vc.is_lead desc, cl.first_name`,
    [id],
  );

  const roster = await query<CleanerOption>(
    `select id, first_name || ' ' || last_name as name
       from cleaners where is_active order by first_name`,
  );

  const address = [visit.line1, visit.line2, `${visit.city}, TX ${visit.postal_code}`]
    .filter(Boolean)
    .join(", ");
  const open = visit.status !== "completed" && visit.status !== "skipped";
  const cancelled = visit.status === "canceled";

  return (
    <div className="mx-auto max-w-3xl px-5 py-10">
      <Link
        href={`/admin?date=${visit.on_date}`}
        className="text-sm font-medium text-accent hover:underline"
      >
        Back to {formatLong(visit.on_date)}
      </Link>

      <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold text-navy">
            {visit.first_name} {visit.last_name}
          </h1>
          <p className="mt-1 text-muted">
            {formatLong(visit.on_date)}, {visit.at_time} &middot;{" "}
            {serviceTypeLabel(visit.service_type)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {cancelled && <Tag tone="bad">Cancelled</Tag>}
          {visit.awaiting_payment && <Tag tone="warn">Unpaid</Tag>}
          <Tag>{visit.status}</Tag>
        </div>
      </div>

      <Card title="Where and who">
        <Row label="Address" value={address} />
        <Row
          label="Property"
          value={propertyLabel({
            unitSize: visit.unit_size,
            bedrooms: visit.bedrooms,
            bathrooms: visit.bathrooms,
          })}
        />
        <Row label="Phone" value={visit.phone} href={`tel:${visit.phone}`} />
        <Row label="Email" value={visit.email} href={`mailto:${visit.email}`} />
        {visit.has_pets && <Row label="Pets" value="Yes, at this address" />}
        <Row
          label="Booking"
          value={visit.origin === "membership" ? "Membership" : "One-time"}
        />
        <Row label="Worth" value={formatCents(visit.price_cents)} />
      </Card>

      {visit.customer_instructions && (
        <Card title="The customer asked">
          <p className="py-3 leading-relaxed text-body">{visit.customer_instructions}</p>
        </Card>
      )}

      <Card title="Crew">
        <div className="py-4">
          <AssignCrew
            visitId={visit.id}
            cleaners={roster}
            crew={crew.map((c) => ({ cleanerId: c.cleaner_id, isLead: c.is_lead }))}
            isHouse={visit.property_kind === "house"}
          />
        </div>

        {/* What each person is owed for this one job. The pay page totals a
            week; this answers the question you have while looking at the job
            in front of you. */}
        {crew.length > 0 && (
          <ul className="divide-y divide-hairline border-t border-hairline">
            {crew.map((c) => (
              <li key={c.cleaner_id} className="flex flex-wrap justify-between gap-3 py-3">
                <span className="text-body">
                  {c.name}
                  {c.is_lead && crew.length > 1 && (
                    <span className="ml-2 text-xs uppercase tracking-wider text-accent">
                      Lead
                    </span>
                  )}
                </span>
                <span className="text-sm">
                  {c.pay_cents == null ? (
                    <span className="text-amber-800">No rate set</span>
                  ) : c.paid_at ? (
                    <span className="text-muted">
                      {formatCents(c.pay_cents)} paid {formatLong(c.paid_at.slice(0, 10))}
                    </span>
                  ) : (
                    <span className="font-medium text-navy">
                      {formatCents(c.pay_cents)} owed
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {visit.awaiting_payment && (
        <Card title="Payment">
          <div className="py-4">
            <p className="mb-3 text-sm leading-relaxed text-muted">
              This one was agreed before it was paid for. Send the link whenever you
              are ready; it is good for 24 hours from the moment you press it.
            </p>
            <SendPaymentLink
              kind={visit.subscription_id ? "membership" : "one_time"}
              id={visit.subscription_id ?? visit.id}
            />
          </div>
        </Card>
      )}

      <Card title="What this job covers">
        <div className="py-4 space-y-4">
          {checklistFor(visit.service_type).map((section) => (
            <div key={section.title}>
              <p className="text-sm font-semibold text-navy">{section.title}</p>
              <ul className="mt-1 space-y-0.5">
                {section.items.map((item) => (
                  <li key={item} className="text-sm leading-relaxed text-muted">
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Card>

      {!cancelled && (
        <Card title="Access and status">
          <div className="flex flex-wrap items-center gap-3 py-4">
            {visit.has_entry_details && (
              <RevealAccess visitId={visit.id} propertyId={visit.property_id} />
            )}
            {open && (
              <>
                <MarkComplete visitId={visit.id} />
                <MarkSkipped visitId={visit.id} />
              </>
            )}
            {visit.origin === "one_off" && open && <CancelVisitAdmin visitId={visit.id} />}
          </div>
          <p className="pb-4 text-xs leading-relaxed text-muted">
            The cleaner&apos;s own link:{" "}
            <span className="break-all font-mono">
              /job/{visit.id}/{visitToken(visit.id)}
            </span>
          </p>
        </Card>
      )}
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6 rounded-2xl border border-hairline bg-white p-5">
      <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">
        {title}
      </h2>
      <div className="mt-1 divide-y divide-hairline">{children}</div>
    </section>
  );
}

function Row({ label, value, href }: { label: string; value: string; href?: string }) {
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

function Tag({
  children,
  tone = "plain",
}: {
  children: React.ReactNode;
  tone?: "plain" | "warn" | "bad";
}) {
  const tones = {
    plain: "border-hairline text-muted",
    warn: "border-amber-300 bg-amber-50 text-amber-900",
    bad: "border-red-200 bg-red-50 text-red-800",
  };
  return (
    <span
      className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-wider ${tones[tone]}`}
    >
      {children}
    </span>
  );
}
