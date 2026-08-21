import type { Metadata } from "next";
import Link from "next/link";
import { query } from "@/lib/db";
import { guardAdminPage } from "@/lib/admin-page";
import { TIMEZONE, formatLong } from "@/lib/dates";
import { RecoveryActions } from "@/components/admin/RecoveryActions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Feedback",
  robots: { index: false, follow: false },
};

/**
 * What customers said, and what still needs chasing.
 *
 * A low rating already set recovery_status to 'needed', but nothing ever
 * displayed it, so the flag was the end of the process rather than the start.
 * Somebody could rate a clean one star, say why, and be met with silence.
 *
 * Ordered by what needs acting on rather than by date: an unresolved complaint
 * from last week matters more than a five star from this morning.
 */
const FILTERS = [
  { key: "open", label: "Needs chasing" },
  { key: "all", label: "Everything" },
  { key: "resolved", label: "Resolved" },
  { key: "unanswered", label: "No reply yet" },
] as const;

type FilterKey = (typeof FILTERS)[number]["key"];

type FeedbackRow = {
  id: string;
  rating: number | null;
  response_text: string | null;
  recovery_status: string;
  recovery_notes: string | null;
  responded_at: string | null;
  sent_at: string | null;
  on_date: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  line1: string;
  city: string;
  postal_code: string;
  cleaner_name: string | null;
};

export default async function FeedbackPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const guard = await guardAdminPage();
  if (!guard.ok) return guard.node;

  const params = await searchParams;
  const filter: FilterKey = FILTERS.some((f) => f.key === params.status)
    ? (params.status as FilterKey)
    : "open";

  const rows = await query<FeedbackRow>(
    `select f.id, f.rating, f.response_text,
            f.recovery_status::text as recovery_status, f.recovery_notes,
            f.responded_at::text as responded_at, f.sent_at::text as sent_at,
            (v.scheduled_for at time zone $1)::date::text as on_date,
            c.first_name, c.last_name, c.email::text as email, c.phone,
            p.line1, p.city, p.postal_code,
            cl.first_name || ' ' || cl.last_name as cleaner_name
       from visit_feedback f
       join visits v on v.id = f.visit_id
       join customers c on c.id = v.customer_id
       join properties p on p.id = v.property_id
       left join cleaners cl on cl.id = v.assigned_cleaner_id
      where case $2
              when 'open'       then f.recovery_status in ('needed', 'in_progress')
              when 'resolved'   then f.recovery_status = 'resolved'
              when 'unanswered' then f.responded_at is null
              else true
            end
      order by
        case f.recovery_status when 'needed' then 0 when 'in_progress' then 1 else 2 end,
        f.rating nulls last,
        v.scheduled_for desc`,
    [TIMEZONE, filter],
  );

  const counts = await query<{ needed: number; in_progress: number; unanswered: number }>(
    `select count(*) filter (where recovery_status = 'needed')::int as needed,
            count(*) filter (where recovery_status = 'in_progress')::int as in_progress,
            count(*) filter (where responded_at is null and sent_at is not null)::int as unanswered
       from visit_feedback`,
  );
  const c = counts[0] ?? { needed: 0, in_progress: 0, unanswered: 0 };

  return (
    <div className="mx-auto max-w-6xl px-5 py-10">

      <div className="mt-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold text-navy">Feedback</h1>
          <p className="mt-1 text-muted">
            {c.needed > 0
              ? `${c.needed} waiting to be picked up`
              : "Nothing waiting to be picked up"}
            {c.in_progress > 0 && `, ${c.in_progress} being dealt with`}
          </p>
        </div>
        {c.unanswered > 0 && (
          <p className="text-sm text-muted">{c.unanswered} asked, no reply yet</p>
        )}
      </div>

      <nav aria-label="Filter feedback" className="mt-5 flex flex-wrap gap-1">
        {FILTERS.map((f) => (
          <Link
            key={f.key}
            href={f.key === "open" ? "/admin/feedback" : `/admin/feedback?status=${f.key}`}
            aria-current={f.key === filter ? "page" : undefined}
            className={
              f.key === filter
                ? "rounded-full bg-navy px-4 py-1.5 text-sm font-semibold text-white"
                : "rounded-full px-4 py-1.5 text-sm font-medium text-muted hover:bg-panel hover:text-body"
            }
          >
            {f.label}
          </Link>
        ))}
      </nav>

      {rows.length === 0 ? (
        <p className="mt-8 rounded-2xl border border-hairline bg-panel p-8 text-center text-muted">
          {filter === "open"
            ? "Nothing needs chasing. That is the good outcome."
            : "Nothing here yet."}
        </p>
      ) : (
        <ul className="mt-6 space-y-4">
          {rows.map((f) => (
            <li key={f.id} className="rounded-2xl border border-hairline bg-white p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Stars rating={f.rating} />
                    <Status status={f.recovery_status} />
                  </div>
                  <p className="mt-2 font-medium text-body">
                    {f.first_name} {f.last_name}
                  </p>
                  <p className="text-sm text-muted">
                    Cleaned {formatLong(f.on_date)} · {f.line1}, {f.city} {f.postal_code}
                    {f.cleaner_name && <> · {f.cleaner_name}</>}
                  </p>
                  <p className="mt-1 text-sm text-muted">
                    <a href={`mailto:${f.email}`} className="text-accent underline">
                      {f.email}
                    </a>{" "}
                    ·{" "}
                    <a href={`tel:${f.phone}`} className="text-accent underline">
                      {f.phone}
                    </a>
                  </p>
                </div>
              </div>

              {f.response_text && (
                <blockquote className="mt-4 rounded-xl bg-panel p-4 text-body">
                  {f.response_text}
                </blockquote>
              )}

              {!f.responded_at && (
                <p className="mt-3 text-sm text-muted">
                  Asked but not answered yet.
                </p>
              )}

              {f.recovery_notes && (
                <div className="mt-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">
                    What has been done
                  </p>
                  <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-body">
                    {f.recovery_notes}
                  </p>
                </div>
              )}

              {f.recovery_status !== "none" && (
                <RecoveryActions id={f.id} status={f.recovery_status} />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Stars({ rating }: { rating: number | null }) {
  if (rating === null) {
    return <span className="text-sm text-muted">No rating</span>;
  }
  const tone =
    rating <= 2
      ? "bg-red-50 text-red-800"
      : rating === 3
        ? "bg-amber-100 text-amber-900"
        : "bg-emerald-100 text-emerald-900";
  return (
    <span className={`rounded-full px-3 py-1 text-sm font-semibold ${tone}`}>
      {rating} out of 5
    </span>
  );
}

function Status({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string }> = {
    needed: { label: "Needs chasing", className: "bg-red-50 text-red-800" },
    in_progress: { label: "Being dealt with", className: "bg-amber-100 text-amber-900" },
    resolved: { label: "Resolved", className: "bg-emerald-100 text-emerald-900" },
    none: { label: "No action needed", className: "bg-panel text-muted" },
  };
  const tone = map[status] ?? map.none;
  return (
    <span className={`rounded-full px-3 py-1 text-xs font-medium ${tone.className}`}>
      {tone.label}
    </span>
  );
}
