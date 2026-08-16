"use client";

import { useState, useTransition } from "react";
import { setRecoveryStatus } from "@/actions/feedback-recovery";

/**
 * Picking a complaint up and closing it out.
 *
 * The note is optional when starting and prompted for when resolving, because
 * "resolved" with no record of what was done is the same as forgetting about
 * it, just tidier.
 */
export function RecoveryActions({ id, status }: { id: string; status: string }) {
  const [notes, setNotes] = useState("");
  const [notice, setNotice] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function move(next: "needed" | "in_progress" | "resolved") {
    setNotice(null);
    startTransition(async () => {
      const result = await setRecoveryStatus(id, next, notes);
      setNotice(result);
      if (result.ok) setNotes("");
    });
  }

  if (status === "resolved") {
    return (
      <div className="mt-4 border-t border-hairline pt-4">
        <button
          type="button"
          disabled={pending}
          onClick={() => move("needed")}
          className="text-sm font-medium text-accent hover:underline disabled:opacity-50"
        >
          Reopen this
        </button>
        {notice && <p className="mt-2 text-sm text-muted">{notice.message}</p>}
      </div>
    );
  }

  return (
    <div className="mt-4 border-t border-hairline pt-4">
      <label className="block text-sm">
        <span className="font-medium text-body">What did you do about it?</span>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          placeholder="Rang them, redoing the bathroom on Thursday at no charge"
          className="mt-1.5 w-full rounded-xl border border-hairline bg-white px-4 py-2.5 text-body"
        />
        <span className="mt-1 block text-xs text-muted">
          Added to the record with today&rsquo;s date and your name. The customer
          never sees this.
        </span>
      </label>

      <div className="mt-3 flex flex-wrap gap-2">
        {status === "needed" && (
          <button
            type="button"
            disabled={pending}
            onClick={() => move("in_progress")}
            className="rounded-full bg-accent px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent-dark disabled:opacity-50"
          >
            {pending ? "Saving…" : "I am on it"}
          </button>
        )}
        <button
          type="button"
          disabled={pending}
          onClick={() => move("resolved")}
          className="rounded-full border border-hairline px-5 py-2 text-sm font-semibold text-body disabled:opacity-50"
        >
          Sorted, close it
        </button>
      </div>

      {notice && (
        <p
          role="status"
          className={`mt-2 text-sm ${notice.ok ? "text-muted" : "text-red-700"}`}
        >
          {notice.message}
        </p>
      )}
    </div>
  );
}
