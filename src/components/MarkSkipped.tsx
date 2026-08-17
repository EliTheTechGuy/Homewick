"use client";

import { useState, useTransition } from "react";
import { markVisitSkipped } from "@/actions/visits";

/**
 * Record a visit nobody could get into.
 *
 * Behind a confirm step rather than a single button, because it consumes the
 * member's allotment for the month. That is a real consequence for them, and
 * it should not be one mis-tap away on a phone held at somebody's front door.
 *
 * The reason is optional but asked for, since "nobody home" and "the code had
 * changed and we were not told" lead to very different conversations later.
 */
export function MarkSkipped({ visitId }: { visitId: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-full border border-hairline px-4 py-2 text-sm font-semibold text-body"
      >
        Could not get in
      </button>
    );
  }

  return (
    <div className="w-full rounded-xl border border-hairline bg-panel p-4">
      <label className="block text-sm">
        <span className="font-medium text-body">What happened?</span>
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Nobody home, rang twice"
          className="mt-1.5 w-full rounded-xl border border-hairline bg-white px-4 py-2.5 text-body"
        />
      </label>
      <p className="mt-2 text-xs leading-relaxed text-muted">
        This uses up one of their two cleanings for the month, which is what the
        service agreement says happens when we cannot get in.
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await markVisitSkipped(visitId, reason);
              if (result.ok) setOpen(false);
              else setError(result.message);
            })
          }
          className="rounded-full bg-navy px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent disabled:opacity-60"
        >
          {pending ? "Saving…" : "Record it"}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
          disabled={pending}
          className="rounded-full border border-hairline px-5 py-2 text-sm font-semibold text-body"
        >
          Cancel
        </button>
      </div>

      {error && (
        <p role="alert" className="mt-2 text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
