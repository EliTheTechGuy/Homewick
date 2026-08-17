"use client";

import { useState, useTransition } from "react";
import { revealJobAccess, type JobRevealResult } from "@/actions/job";

/**
 * Entry details on the cleaner's job page.
 *
 * Hidden behind a deliberate tap for the same reason as the admin version:
 * every reveal is logged, and a screen that shows codes on load would make
 * that log meaningless. It also means a phone left unlocked on a kitchen
 * counter is not showing somebody's door code.
 */
export function JobAccess({
  visitId,
  token,
  unlocked,
}: {
  visitId: string;
  token: string;
  unlocked: boolean;
}) {
  const [result, setResult] = useState<JobRevealResult | null>(null);
  const [pending, startTransition] = useTransition();

  if (result?.ok) {
    const entries = [
      ["Gate code", result.gateCode],
      ["Door code", result.doorCode],
      ["Key location", result.keyLocation],
      ["Alarm", result.alarmInstructions],
    ].filter(([, value]) => value) as [string, string][];

    return (
      <div role="status" className="rounded-2xl border border-accent bg-accent/5 p-5">
        <p className="text-xs font-semibold uppercase tracking-wider text-accent">
          Entry details
        </p>
        <dl className="mt-3 space-y-3">
          {entries.map(([label, value]) => (
            <div key={label}>
              <dt className="text-sm text-muted">{label}</dt>
              <dd className="text-2xl font-semibold tracking-wide text-navy">{value}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 text-xs leading-relaxed text-muted">
          This was recorded against your name. Please do not write these down or
          pass them on.
        </p>
      </div>
    );
  }

  if (!unlocked) {
    return (
      <div className="rounded-2xl border border-hairline bg-panel p-5">
        <p className="font-medium text-body">Entry details are locked</p>
        <p className="mt-1 text-sm leading-relaxed text-muted">
          They unlock on the morning of the visit. Open this page again when you
          are on your way.
        </p>
      </div>
    );
  }

  return (
    <div>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => setResult(await revealJobAccess(visitId, token)))
        }
        className="w-full rounded-full bg-accent px-6 py-4 text-base font-semibold text-white transition-colors hover:bg-accent-dark disabled:opacity-60"
      >
        {pending ? "Opening…" : "Show entry details"}
      </button>
      <p className="mt-2 text-center text-xs text-muted">
        Opening this is recorded against your name.
      </p>
      {result && !result.ok && (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {result.error}
        </p>
      )}
    </div>
  );
}
