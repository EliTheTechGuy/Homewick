import Link from "next/link";

/**
 * Admin was one page, so there was nowhere to navigate to and no nav.
 * Now that there are several, this is the spine.
 */
/**
 * Only pages that exist. Members and history are coming, and a tab that leads
 * to a 404 is worse than a tab that is not there yet.
 */
const TABS = [
  { key: "day", href: "/admin", label: "Schedule" },
  { key: "cleaners", href: "/admin/cleaners", label: "Cleaners" },
] as const;

export function AdminNav({ current }: { current: (typeof TABS)[number]["key"] }) {
  return (
    <nav aria-label="Admin sections" className="flex flex-wrap gap-1">
      {TABS.map((tab) => {
        const active = tab.key === current;
        return (
          <Link
            key={tab.key}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={
              active
                ? "rounded-full bg-navy px-4 py-2 text-sm font-semibold text-white"
                : "rounded-full px-4 py-2 text-sm font-medium text-muted transition-colors hover:bg-panel hover:text-body"
            }
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
