import type { Metadata } from "next";
import Link from "next/link";
import { AdminNav } from "@/components/admin/AdminNav";
import { Card } from "@/components/ui";
import { query } from "@/lib/db";
import { requireAdmin } from "@/lib/admin-auth";
import { TIMEZONE } from "@/lib/dates";
import { EnquiryStatus } from "@/components/admin/EnquiryStatus";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Quote requests",
  robots: { index: false, follow: false },
};

type Row = {
  id: string;
  name: string;
  email: string;
  phone: string;
  address: string | null;
  square_feet: number | null;
  has_pets: boolean;
  service_type: string;
  frequency: string | null;
  message: string | null;
  status: string;
  received: string;
};

/**
 * House quote requests, newest first, open ones at the top.
 *
 * A lead nobody answers is worth nothing, so this opens on what is still
 * unanswered rather than on a full history. Won and lost drop below.
 */
export default async function EnquiriesPage() {
  const admin = await requireAdmin();
  if (!admin) return null;

  const rows = await query<Row>(
    `select id, name, email::text as email, phone, address, square_feet,
            has_pets, service_type, frequency, message, status,
            to_char(created_at at time zone $1, 'FMMon FMDD, FMHH12:MI am') as received
       from enquiries
      order by (status in ('new', 'quoted')) desc, created_at desc
      limit 100`,
    [TIMEZONE],
  );

  const open = rows.filter((r) => r.status === "new" || r.status === "quoted").length;

  return (
    <div className="mx-auto max-w-5xl px-5 py-10">
      <AdminNav current="enquiries" />
      <h1 className="mt-6 text-3xl font-semibold text-navy">Quote requests</h1>
      <p className="mt-3 max-w-2xl leading-relaxed text-muted">
        Houses cannot be priced from the published rates, so these come in as requests.
        Quote them, then create the booking under{" "}
        <Link href="/admin/new" className="font-medium text-accent hover:underline">
          New booking
        </Link>
        .
      </p>

      <div className="mt-6 rounded-xl border border-hairline px-5 py-4">
        <p className="text-xs uppercase tracking-widest text-muted">Waiting on you</p>
        <p className="mt-1 text-2xl font-semibold text-navy">{open}</p>
      </div>

      {rows.length === 0 ? (
        <p className="mt-10 text-muted">No requests yet.</p>
      ) : (
        <div className="mt-8 space-y-4">
          {rows.map((r) => (
            <Card key={r.id} className={r.status === "won" || r.status === "lost" ? "opacity-60" : ""}>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold text-navy">{r.name}</h2>
                  <p className="text-sm text-muted">
                    <a href={`mailto:${r.email}`} className="hover:underline">{r.email}</a>
                    {" · "}
                    <a href={`tel:${r.phone}`} className="hover:underline">{r.phone}</a>
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-muted">{r.received}</p>
                  <EnquiryStatus id={r.id} status={r.status} />
                </div>
              </div>

              <dl className="mt-4 grid gap-x-8 gap-y-2 border-t border-hairline pt-4 text-sm sm:grid-cols-2">
                {r.address && <Fact label="Address" value={r.address} />}
                {r.square_feet && <Fact label="Size" value={`about ${r.square_feet} sq ft`} />}
                <Fact label="Service" value={r.service_type.replace("_", " ")} />
                {r.frequency && <Fact label="How often" value={r.frequency} />}
                {r.has_pets && <Fact label="Pets" value="Yes" />}
              </dl>

              {r.message && (
                <p className="mt-4 border-t border-hairline pt-4 leading-relaxed text-body">
                  {r.message}
                </p>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-widest text-muted">{label}</dt>
      <dd className="text-body">{value}</dd>
    </div>
  );
}
