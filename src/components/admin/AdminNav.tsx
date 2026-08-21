import Link from "next/link";
import { queryOne } from "@/lib/db";
import { currentAdmin } from "@/lib/admin-auth";
import { AdminSignOut } from "./AdminSignOut";

/**
 * Admin was one page, so there was nowhere to navigate to and no nav.
 * Now that there are several, this is the spine.
 *
 * Ordered by how often a day actually needs them: the schedule is the working
 * screen, members and cleaners are reference, history is what you reach for
 * when somebody rings up asking about a clean from three weeks ago.
 */
const TABS = [
  { key: "day", href: "/admin", label: "Schedule" },
  { key: "metrics", href: "/admin/metrics", label: "Metrics" },
  { key: "new", href: "/admin/new", label: "New booking" },
  { key: "members", href: "/admin/members", label: "Members" },
  { key: "enquiries", href: "/admin/enquiries", label: "Quotes" },
  { key: "cleaners", href: "/admin/cleaners", label: "Cleaners" },
  { key: "pay", href: "/admin/pay", label: "Pay" },
  { key: "feedback", href: "/admin/feedback", label: "Feedback" },
  { key: "history", href: "/admin/history", label: "History" },
  { key: "emails", href: "/admin/emails", label: "Emails" },
] as const;

export async function AdminNav({ current }: { current: (typeof TABS)[number]["key"] }) {
  // An unhappy customer waiting on a callback is the one thing in admin that
  // gets worse the longer it goes unseen, so the count rides on the nav rather
  // than waiting to be discovered on a page nobody opened.
  const pending = await queryOne<{ n: number }>(
    `select count(*)::int as n from visit_feedback
      where recovery_status in ('needed', 'in_progress')`,
  ).catch(() => null);
  const waiting = pending?.n ?? 0;
  const admin = await currentAdmin();

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
    <nav aria-label="Admin sections" className="flex flex-wrap gap-1">
      {TABS.map((tab) => {
        const active = tab.key === current;
        const showCount = tab.key === "feedback" && waiting > 0;

        return (
          <Link
            key={tab.key}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={
              active
                ? "flex items-center gap-2 rounded-full bg-navy px-4 py-2 text-sm font-semibold text-white"
                : "flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium text-muted transition-colors hover:bg-panel hover:text-body"
            }
          >
            {tab.label}
            {showCount && (
              <span
                aria-label={`${waiting} needing attention`}
                className={
                  active
                    ? "rounded-full bg-white px-1.5 text-xs font-semibold text-navy"
                    : "rounded-full bg-red-100 px-1.5 text-xs font-semibold text-red-800"
                }
              >
                {waiting}
              </span>
            )}
          </Link>
        );
      })}
    </nav>

      {admin && (
        <div className="flex items-center gap-3 text-sm text-muted">
          <span>{admin.name}</span>
          <AdminSignOut />
        </div>
      )}
    </div>
  );
}
