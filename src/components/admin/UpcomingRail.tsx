import Link from "next/link";
import { formatLong, type ISODate } from "@/lib/dates";

export type UpcomingRow = {
  id: string;
  on_date: string;
  at_time: string;
  first_name: string;
  last_name: string;
  line1: string;
  cleaner_name: string | null;
};

/**
 * What is coming, regardless of which day is being looked at.
 *
 * The calendar answers "what does the month look like" and the day list
 * answers "what is happening on this date". Neither answers "what is next",
 * which is the question actually being asked when somebody opens this screen
 * on a Sunday evening.
 *
 * Grouped by day, because a flat list of times with no dates reads as one
 * long shift.
 */
export function UpcomingRail({ rows, from }: { rows: UpcomingRow[]; from: ISODate }) {
  const days = new Map<string, UpcomingRow[]>();
  for (const row of rows) {
    const list = days.get(row.on_date) ?? [];
    list.push(row);
    days.set(row.on_date, list);
  }

  return (
    <section className="rounded-2xl border border-hairline bg-white p-5">
      <h2 className="text-sm font-semibold text-navy">Coming up</h2>

      {rows.length === 0 ? (
        <p className="mt-3 text-sm leading-relaxed text-muted">
          Nothing scheduled from {formatLong(from)} onward.
        </p>
      ) : (
        <div className="mt-4 space-y-5">
          {[...days.entries()].map(([date, visits]) => (
            <div key={date}>
              <Link
                href={`/admin?date=${date}`}
                className="text-xs font-semibold uppercase tracking-[0.1em] text-accent hover:underline"
              >
                {formatLong(date)}
              </Link>
              <ul className="mt-2 space-y-2">
                {visits.map((v) => (
                  <li key={v.id} className="text-sm leading-snug">
                    <span className="font-medium text-body">
                      {v.at_time} {v.first_name} {v.last_name}
                    </span>
                    <br />
                    <span className="text-muted">{v.line1}</span>
                    <br />
                    <span
                      className={
                        v.cleaner_name ? "text-muted" : "font-medium text-amber-700"
                      }
                    >
                      {v.cleaner_name ?? "needs a cleaner"}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
