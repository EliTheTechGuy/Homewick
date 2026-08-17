"use client";

import { useState, useTransition } from "react";
import { revealAccess, type RevealResult } from "@/actions/reveal";

/**
 * Entry codes stay hidden until someone deliberately asks for them, because
 * every reveal is logged against a named actor. A screen that displays them
 * by default would make that log meaningless.
 */
export function RevealAccess({
  visitId,
  propertyId,
}: {
  visitId: string;
  propertyId: string;
}) {
  const [result, setResult] = useState<RevealResult | null>(null);
  const [pending, startTransition] = useTransition();

  if (result?.ok) {
    const entries = [
      ["Gate code", result.gateCode],
      ["Door code", result.doorCode],
      ["Key location", result.keyLocation],
      ["Alarm", result.alarmInstructions],
    ].filter(([, value]) => value) as [string, string][];

    return (
      <div role="status" className="rounded-xl border border-accent bg-accent/5 p-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-accent">
          Entry details, and this reveal was logged
        </p>
        <dl className="mt-2 space-y-1">
          {entries.map(([label, value]) => (
            <div key={label} className="flex gap-2 text-sm">
              <dt className="text-muted">{label}:</dt>
              <dd className="font-medium text-navy">{value}</dd>
            </div>
          ))}
        </dl>
      </div>
    );
  }

  return (
    <div>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => setResult(await revealAccess(propertyId, visitId)))
        }
        className="rounded-full border border-accent px-4 py-2 text-sm font-semibold text-accent transition-colors hover:bg-accent hover:text-white disabled:opacity-60"
      >
        {pending ? "Revealing…" : "Reveal entry details"}
      </button>
      {result && !result.ok && (
        <p role="alert" className="mt-2 text-sm text-red-700">
          {result.error}
        </p>
      )}
    </div>
  );
}
