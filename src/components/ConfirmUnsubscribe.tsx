"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { stopAddOnNudges } from "@/actions/unsubscribe";

/** The click, rather than the page load, is what acts. See the page comment. */
export function ConfirmUnsubscribe({
  customerId,
  token,
}: {
  customerId: string;
  token: string;
}) {
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, startTransition] = useTransition();

  if (result) {
    return (
      <div className="mt-8">
        <p
          role="status"
          className={`rounded-xl px-4 py-3 ${
            result.ok ? "bg-panel text-body" : "bg-red-50 text-red-800"
          }`}
        >
          {result.message}
        </p>
        <p className="mt-4 text-sm leading-relaxed text-muted">
          Changed your mind? Your free add-on is still there each month, and you
          can pick it any time from{" "}
          <Link href="/account" className="text-accent underline">
            your account
          </Link>
          .
        </p>
      </div>
    );
  }

  return (
    <div className="mt-8 flex flex-wrap gap-3">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => setResult(await stopAddOnNudges(customerId, token)))
        }
        className="rounded-full bg-accent px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-accent-dark disabled:opacity-60"
      >
        {pending ? "Saving…" : "Yes, stop them"}
      </button>
      <Link
        href="/account"
        className="rounded-full border border-hairline px-6 py-3 text-sm font-semibold text-body"
      >
        Keep them
      </Link>
    </div>
  );
}
