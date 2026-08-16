"use client";

import { useState, useTransition } from "react";
import { assignCleaner } from "@/actions/cleaners";

export type CleanerOption = { id: string; name: string };

/**
 * Put somebody on a job, or take them off.
 *
 * Saving on change rather than behind a separate button: this gets used
 * repeatedly while working down a day, and an extra click each time adds up.
 */
export function AssignCleaner({
  visitId,
  assignedId,
  cleaners,
}: {
  visitId: string;
  assignedId: string | null;
  cleaners: CleanerOption[];
}) {
  const [value, setValue] = useState(assignedId ?? "");
  const [notice, setNotice] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();

  if (cleaners.length === 0) {
    return (
      <p className="text-sm text-muted">
        No cleaners on the roster yet.{" "}
        <a href="/admin/cleaners" className="text-accent underline">
          Add one
        </a>{" "}
        and you can assign this.
      </p>
    );
  }

  function change(next: string) {
    setValue(next);
    setNotice(null);
    startTransition(async () => {
      const result = await assignCleaner(visitId, next);
      setFailed(!result.ok);
      setNotice(result.message);
    });
  }

  return (
    <div>
      <label className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted">Cleaner</span>
        <select
          value={value}
          disabled={pending}
          onChange={(e) => change(e.target.value)}
          className="rounded-xl border border-hairline bg-white px-3 py-2 text-body disabled:opacity-60"
        >
          <option value="">Unassigned</option>
          {cleaners.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        {pending && <span className="text-xs text-muted">Saving…</span>}
      </label>
      {notice && (
        <p
          role="status"
          className={`mt-1 text-xs ${failed ? "text-red-700" : "text-muted"}`}
        >
          {notice}
        </p>
      )}
    </div>
  );
}
