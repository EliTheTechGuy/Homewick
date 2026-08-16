import Link from "next/link";
import { addDays, addMonths, weekday, type ISODate } from "@/lib/dates";

export type DayCount = { on_date: string; total: number; unassigned: number };

/**
 * A month at a glance.
 *
 * The admin view showed one day and nothing else, so planning next week meant
 * guessing a date and editing the URL. The number on each day is how much work
 * is on it; a day carrying unassigned work is marked, because that is the only
 * thing on this screen that needs acting on rather than just knowing.
 *
 * Server rendered, with plain links rather than click handlers, so the
 * selected day survives a refresh and can be shared or bookmarked.
 */
export function MonthCalendar({
  month,
  selected,
  today,
  counts,
}: {
  /** Any date inside the month being shown. */
  month: ISODate;
  selected: ISODate;
  today: ISODate;
  counts: DayCount[];
}) {
  const byDate = new Map(counts.map((c) => [c.on_date, c]));

  const first = `${month.slice(0, 7)}-01` as ISODate;
  const daysInMonth = Number(addDays(addMonths(first, 1), -1).slice(8, 10));

  // Blank cells so the first of the month lands under its weekday.
  const lead = weekday(first);
  const cells: (ISODate | null)[] = Array.from({ length: lead }, () => null);
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(`${month.slice(0, 7)}-${String(d).padStart(2, "0")}` as ISODate);
  }

  const monthLabel = new Date(`${first}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

  return (
    <section className="rounded-2xl border border-hairline bg-white p-4">
      <header className="flex items-center justify-between gap-2">
        <Link
          href={`/admin?date=${addMonths(first, -1)}`}
          aria-label="Previous month"
          className="rounded-full px-3 py-1.5 text-lg leading-none text-muted transition-colors hover:bg-panel hover:text-body"
        >
          ‹
        </Link>
        <h2 className="text-sm font-semibold text-navy">{monthLabel}</h2>
        <Link
          href={`/admin?date=${addMonths(first, 1)}`}
          aria-label="Next month"
          className="rounded-full px-3 py-1.5 text-lg leading-none text-muted transition-colors hover:bg-panel hover:text-body"
        >
          ›
        </Link>
      </header>

      <div className="mt-3 grid grid-cols-7 gap-1 text-center">
        {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
          <span key={i} className="pb-1 text-[11px] font-semibold text-muted">
            {d}
          </span>
        ))}

        {cells.map((date, i) => {
          if (!date) return <span key={`blank-${i}`} />;

          const count = byDate.get(date);
          const isSelected = date === selected;
          const isToday = date === today;

          return (
            <Link
              key={date}
              href={`/admin?date=${date}`}
              aria-current={isSelected ? "date" : undefined}
              aria-label={`${date}, ${count?.total ?? 0} cleanings`}
              className={[
                "relative flex aspect-square flex-col items-center justify-center rounded-lg text-sm transition-colors",
                isSelected
                  ? "bg-navy font-semibold text-white"
                  : isToday
                    ? "bg-panel font-semibold text-navy"
                    : "text-body hover:bg-panel",
              ].join(" ")}
            >
              <span>{Number(date.slice(8, 10))}</span>
              {count && count.total > 0 && (
                <span
                  className={[
                    "mt-0.5 text-[10px] font-medium leading-none",
                    isSelected ? "text-white/80" : "text-muted",
                  ].join(" ")}
                >
                  {count.total}
                </span>
              )}
              {count && count.unassigned > 0 && (
                <span
                  aria-hidden
                  className={[
                    "absolute right-1 top-1 h-1.5 w-1.5 rounded-full",
                    isSelected ? "bg-white" : "bg-amber-500",
                  ].join(" ")}
                />
              )}
            </Link>
          );
        })}
      </div>

      <p className="mt-3 flex items-center gap-1.5 text-[11px] text-muted">
        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-amber-500" />
        needs a cleaner
      </p>
    </section>
  );
}
