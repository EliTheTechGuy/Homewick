"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { chargeSavedCard } from "@/actions/charge-card";
import { formatCents } from "@/lib/money";

/**
 * Take the money on the morning of the clean.
 *
 * Confirms first, unlike the two Send buttons either side of it. Those cost a
 * duplicate email at worst. This one moves real money out of somebody's
 * account, and the amount is named in the confirm so that pressing it on the
 * wrong row is a thing you notice before it happens rather than after.
 */
export function ChargeCard({
  visitId,
  amountCents,
  customerName,
}: {
  visitId: string;
  amountCents: number;
  customerName: string;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  function charge() {
    setMessage(null);
    startTransition(async () => {
      const result = await chargeSavedCard({ visitId });
      setFailed(!result.ok);
      setMessage(result.message);
      setConfirming(false);
      if (result.ok) router.refresh();
    });
  }

  if (message && !failed) {
    return (
      <span role="status" className="text-sm font-medium text-green-700">
        {message}
      </span>
    );
  }

  if (!confirming) {
    return (
      <span className="inline-flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="rounded-full bg-green-700 px-4 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-green-800"
        >
          Charge card
        </button>
        {message && failed && (
          <span role="alert" className="text-sm text-red-700">
            {message}
          </span>
        )}
      </span>
    );
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span className="text-sm text-body">
        Take {formatCents(amountCents)} from {customerName}?
      </span>
      <button
        type="button"
        onClick={charge}
        disabled={pending}
        className="rounded-full bg-green-700 px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
      >
        {pending ? "Charging…" : "Yes, charge it"}
      </button>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        disabled={pending}
        className="text-sm text-muted"
      >
        Never mind
      </button>
    </span>
  );
}
