"use client";

import { useState, useTransition } from "react";
import { markVisitComplete } from "@/actions/visits";

export function MarkComplete({ visitId }: { visitId: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await markVisitComplete(visitId);
            setError(result.ok ? null : result.message);
          })
        }
        className="rounded-full bg-navy px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent disabled:opacity-60"
      >
        {pending ? "Saving…" : "Mark complete"}
      </button>
      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
    </div>
  );
}
