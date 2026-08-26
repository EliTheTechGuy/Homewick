"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AdminSignOut } from "./AdminSignOut";

/**
 * Ordered by how often a day actually needs them. The schedule is the working
 * screen, members and cleaners are reference, and metrics sits last because
 * it is something you look at deliberately rather than reach for mid-job.
 */
const TABS = [
  { href: "/admin", label: "Schedule" },
  { href: "/admin/bookings", label: "Bookings" },
  { href: "/admin/new", label: "New booking" },
  { href: "/admin/members", label: "Members" },
  { href: "/admin/enquiries", label: "Quotes" },
  { href: "/admin/cleaners", label: "Cleaners" },
  { href: "/admin/pay", label: "Pay" },
  { href: "/admin/feedback", label: "Feedback" },
  { href: "/admin/history", label: "History" },
  { href: "/admin/emails", label: "Emails" },
  { href: "/admin/metrics", label: "Metrics" },
];

/**
 * Which tab is active is read from the URL rather than passed in by each page.
 *
 * Every page used to declare its own key, which meant a new page could quietly
 * highlight the wrong tab, or none, and nothing would catch it. The URL always
 * knows.
 */
export function AdminTabs({
  waiting,
  adminName,
}: {
  waiting: number;
  adminName: string | null;
}) {
  const pathname = usePathname();

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <nav aria-label="Admin sections" className="flex flex-wrap gap-1">
        {TABS.map((tab) => {
          // Exact match for the schedule, since every other path starts with
          // it and it would otherwise light up on every page.
          const active =
            tab.href === "/admin" ? pathname === "/admin" : pathname.startsWith(tab.href);
          const showCount = tab.href === "/admin/feedback" && waiting > 0;

          return (
            <Link
              key={tab.href}
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

      {adminName && (
        <div className="flex items-center gap-3 text-sm text-muted">
          <span>{adminName}</span>
          <AdminSignOut />
        </div>
      )}
    </div>
  );
}
