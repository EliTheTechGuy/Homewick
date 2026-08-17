"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { rescheduleVisit } from "@/actions/reschedule";
import { addDays, formatLong, today } from "@/lib/dates";
import type { UpcomingVisit } from "@/lib/member-account";

/**
 * Move one cleaning.
 *
 * The picker is bounded by what the server will accept, so a member is never
 * offered a date that comes back rejected. Two days of notice at the near end,
 * and the last day of the billing period at the far end, because cleanings do
 * not carry into next month.
 */
export function RescheduleVisit({ visit }: { visit: UpcomingVisit }) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(visit.onDate);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // The trigger unmounts when the panel opens, so focus would otherwise fall
  // to the body and a keyboard user would be left at the top of the page with
  // no idea anything had opened. Closing puts them back where they were.
  useEffect(() => {
    if (open) panelRef.current?.focus();
    else triggerRef.current?.focus();
  }, [open]);

  const earliest = addDays(today(), 2);
  const latest = visit.periodEndsOn ? addDays(visit.periodEndsOn, -1) : undefined;

  function save() {
    setError(null);
    startTransition(async () => {
      const result = await rescheduleVisit(visit.id, date);
      if (result.ok) setOpen(false);
      else setError(result.message);
    });
  }

  if (!open) {
    return (
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        className="text-sm font-medium text-accent hover:underline"
      >
        Change date
      </button>
    );
  }

  return (
    <div
      ref={panelRef}
      tabIndex={-1}
      role="group"
      aria-label="Move this cleaning"
      className="mt-3 w-full rounded-xl border border-hairline bg-panel p-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      <label className="block">
        <span className="text-sm font-medium text-body">Move this cleaning to</span>
        <input
          type="date"
          value={date}
          min={earliest}
          max={latest}
          onChange={(e) => setDate(e.target.value)}
          className="mt-2 w-full rounded-xl border border-hairline bg-white px-4 py-2.5 text-body"
        />
      </label>

      {latest && (
        <p className="mt-2 text-xs leading-relaxed text-muted">
          Any day up to {formatLong(latest)}. Cleanings stay within the month they
          belong to. We will keep this day for future months unless you change it
          again.
        </p>
      )}

      {error && (
        <p role="alert" className="mt-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={save}
          disabled={pending || date === visit.onDate}
          className="rounded-full bg-accent px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent-dark disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setError(null);
            setDate(visit.onDate);
          }}
          disabled={pending}
          className="rounded-full border border-hairline px-5 py-2 text-sm font-semibold text-body"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
