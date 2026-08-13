import type { Metadata } from "next";
import { query, isDatabaseConfigured } from "@/lib/db";
import { requireAdmin, isAdminConfigured } from "@/lib/admin-auth";
import { TIMEZONE, formatLong, today } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { unitSizeLabel, type UnitSize } from "@/lib/pricing";
import { RevealAccess } from "@/components/RevealAccess";

export const metadata: Metadata = { title: "Today", robots: { index: false } };
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
};

export default async function AdminTodayPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  if (!isAdminConfigured()) {
    return <Notice title="Admin is not configured">Set ADMIN_PASSWORD to enable it.</Notice>;
  }

  const admin = await requireAdmin();
  if (!admin) {
    return (
      <Notice title="Sign in required">
        This view is protected. Reload with your admin credentials.
      </Notice>
    );
  }

  if (!isDatabaseConfigured()) {
    return <Notice title="No database">Set DATABASE_URL and run db/schema.sql.</Notice>;
  }

  const { date } = await searchParams;
  const day = date ?? today();

  const visits = await query<VisitRow>(
    `select v.id, v.property_id, v.status::text as status, v.origin::text as origin,
            v.service_type::text as service_type,
            to_char(v.scheduled_for at time zone $2, 'HH12:MI AM') as scheduled_at,
            v.customer_instructions, v.base_amount_cents, v.pet_surcharge_cents,
            v.addons_amount_cents,
            p.unit_size, p.has_pets, p.line1, p.line2, p.city, p.postal_code,
            c.first_name, c.last_name, c.phone,
            cl.first_name || ' ' || cl.last_name as cleaner_name,
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
        and v.status <> 'canceled'
      order by v.scheduled_for`,
    [day, TIMEZONE],
  );

  return (
    <div className="mx-auto max-w-5xl px-5 py-12">
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold text-navy">Today</h1>
          <p className="mt-1 text-muted">{formatLong(day)}</p>
        </div>
        <p className="text-sm text-muted">
          {visits.length} {visits.length === 1 ? "visit" : "visits"}
        </p>
      </div>

      {visits.length === 0 ? (
        <p className="mt-12 rounded-2xl border border-hairline bg-panel p-8 text-center text-muted">
          Nothing scheduled.
        </p>
      ) : (
        <ul className="mt-10 space-y-5">
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
                {visit.has_pets && <Tag tone="warn">Pets · {formatCents(visit.pet_surcharge_cents)}</Tag>}
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
                <RevealAccess visitId={visit.id} propertyId={visit.property_id} />
                <p className="text-sm text-muted">
                  Cleaner:{" "}
                  <span className="font-medium text-body">
                    {visit.cleaner_name ?? "unassigned"}
                  </span>
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
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
