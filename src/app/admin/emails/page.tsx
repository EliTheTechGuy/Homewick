import type { Metadata } from "next";
import Link from "next/link";
import { query } from "@/lib/db";
import { guardAdminPage } from "@/lib/admin-page";
import { TIMEZONE } from "@/lib/dates";
import { AdminNav } from "@/components/admin/AdminNav";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Emails",
  robots: { index: false, follow: false },
};

const PAGE_SIZE = 60;

/**
 * Every email the system tried to send.
 *
 * This exists for one question, asked on the phone: "I never got it." Without
 * a record the honest answer is a shrug, and the customer is left deciding
 * whether to trust the business. With one you can say it went at 9:02 and
 * suggest they check their spam folder, or see that it never went and fix it.
 *
 * Read only. Resending is deliberately not offered: a reminder resent three
 * days late is worse than none, and a sign-in link is one click away for the
 * customer anyway.
 */
const KINDS: Record<string, string> = {
  member_sign_in: "Sign-in link",
  one_time_booking: "Booking confirmation",
  membership_welcome: "Membership welcome",
  visit_reminder: "Visit reminder",
  free_add_on_nudge: "Free add-on nudge",
  feedback_request: "Feedback request",
  cancellation_confirmed: "Cancellation",
  cleaner_assignment: "Cleaner job",
  owner_booking_alert: "New booking alert",
  visit_moved_alert: "Cleaning moved alert",
};

type Row = {
  id: string;
  kind: string;
  recipient: string | null;
  delivered: boolean;
  sent_at: string;
  customer_name: string | null;
};

export default async function EmailsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; failed?: string; page?: string }>;
}) {
  const guard = await guardAdminPage();
  if (!guard.ok) return guard.node;

  const params = await searchParams;
  const search = (params.q ?? "").trim();
  const failedOnly = params.failed === "1";
  const page = Math.max(1, Number(params.page) || 1);

  const rows = await query<Row>(
    `select e.id, e.kind, e.recipient::text as recipient, e.delivered,
            to_char(e.sent_at at time zone $1, 'Mon DD, HH24:MI') as sent_at,
            c.first_name || ' ' || c.last_name as customer_name
       from email_deliveries e
       left join customers c on c.id = e.customer_id
      where ($2 = '' or e.recipient::text ilike '%' || $2 || '%'
             or c.first_name ilike '%' || $2 || '%'
             or c.last_name  ilike '%' || $2 || '%')
        and ($3 = false or e.delivered = false)
      order by e.sent_at desc
      limit $4 offset $5`,
    [TIMEZONE, search, failedOnly, PAGE_SIZE + 1, (page - 1) * PAGE_SIZE],
  );

  const hasMore = rows.length > PAGE_SIZE;
  const emails = hasMore ? rows.slice(0, PAGE_SIZE) : rows;

  const stats = await query<{ total: number; failed: number }>(
    `select count(*)::int as total,
            count(*) filter (where delivered = false)::int as failed
       from email_deliveries where sent_at > now() - interval '30 days'`,
  );
  const s = stats[0] ?? { total: 0, failed: 0 };

  const qs = (over: Record<string, string | number>) => {
    const next = new URLSearchParams();
    if (search) next.set("q", search);
    if (failedOnly) next.set("failed", "1");
    for (const [k, v] of Object.entries(over)) {
      if (v === "" || v === 0) next.delete(k);
      else next.set(k, String(v));
    }
    const str = next.toString();
    return str ? `/admin/emails?${str}` : "/admin/emails";
  };

  return (
    <div className="mx-auto max-w-5xl px-5 py-10">
      <AdminNav current="emails" />

      <div className="mt-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold text-navy">Emails</h1>
          <p className="mt-1 text-muted">
            {s.total} sent in the last 30 days
            {s.failed > 0 && `, ${s.failed} that did not go`}
          </p>
        </div>
      </div>

      <form method="get" className="mt-5 flex flex-wrap gap-2">
        <input
          type="search"
          name="q"
          defaultValue={search}
          placeholder="Email address or customer name"
          aria-label="Search sent emails"
          className="min-w-0 flex-1 rounded-xl border border-hairline bg-white px-4 py-2.5 text-body"
        />
        {failedOnly && <input type="hidden" name="failed" value="1" />}
        <button
          type="submit"
          className="rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-accent-dark"
        >
          Search
        </button>
      </form>

      <nav aria-label="Filter emails" className="mt-4 flex flex-wrap gap-1">
        <Link
          href={qs({ failed: "", page: 0 })}
          aria-current={!failedOnly ? "page" : undefined}
          className={
            !failedOnly
              ? "rounded-full bg-navy px-4 py-1.5 text-sm font-semibold text-white"
              : "rounded-full px-4 py-1.5 text-sm font-medium text-muted hover:bg-panel hover:text-body"
          }
        >
          Everything
        </Link>
        <Link
          href={qs({ failed: 1, page: 0 })}
          aria-current={failedOnly ? "page" : undefined}
          className={
            failedOnly
              ? "rounded-full bg-navy px-4 py-1.5 text-sm font-semibold text-white"
              : "rounded-full px-4 py-1.5 text-sm font-medium text-muted hover:bg-panel hover:text-body"
          }
        >
          Did not send
        </Link>
      </nav>

      {emails.length === 0 ? (
        <p className="mt-8 rounded-2xl border border-hairline bg-panel p-8 text-center text-muted">
          {search ? `Nothing matching "${search}".` : "No emails recorded yet."}
        </p>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-2xl border border-hairline bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-hairline text-left">
                <Th>When</Th>
                <Th>Email</Th>
                <Th>To</Th>
                <Th>Went</Th>
              </tr>
            </thead>
            <tbody>
              {emails.map((e) => (
                <tr key={e.id} className="border-b border-hairline last:border-none">
                  <td className="whitespace-nowrap px-4 py-3 text-muted">{e.sent_at}</td>
                  <td className="px-4 py-3 font-medium text-body">
                    {KINDS[e.kind] ?? e.kind}
                  </td>
                  <td className="px-4 py-3 text-muted">
                    {e.recipient}
                    {e.customer_name && (
                      <span className="block text-xs">{e.customer_name}</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    {e.delivered ? (
                      <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-900">
                        Sent
                      </span>
                    ) : (
                      <span className="rounded-full bg-red-50 px-2.5 py-0.5 text-xs font-medium text-red-800">
                        Did not send
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(page > 1 || hasMore) && (
        <div className="mt-6 flex items-center justify-between">
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

      <p className="mt-6 text-sm leading-relaxed text-muted">
        A line here means we handed the message to Resend and it accepted. It does
        not prove the message reached an inbox rather than a spam folder.
      </p>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-4 py-3 text-xs font-medium uppercase tracking-wider text-muted">
      {children}
    </th>
  );
}
