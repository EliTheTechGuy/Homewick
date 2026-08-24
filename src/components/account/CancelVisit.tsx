"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cancelMyVisit } from "@/actions/cancel-visit";
import { formatCents } from "@/lib/money";
import type { UpcomingVisit } from "@/lib/member-account";

/**
 * Calling off a one-time clean.
 *
 * The refund is on the confirm step, not in a policy page somebody has to go
 * and find. The whole reason a cancellation turns into a dispute is that the
 * customer did not know what they were agreeing to until the statement
 * arrived, so the number and the reason for it are both here before the
 * button that spends them.
 *
 * Two steps rather than one. Cancelling is not reversible and the button sits
 * beside a date, which is exactly the shape of a mis-tap.
 */
export function CancelVisit({ visit }: { visit: UpcomingVisit }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();

  if (!visit.isOneOff || !visit.cancellation) return null;

  const { refundCents, feeCents } = visit.cancellation;

  function cancel() {
    startTransition(async () => {
      const result = await cancelMyVisit(visit.id);
      setFailed(!result.ok);
      setMessage(result.message);
      if (result.ok) {
        setConfirming(false);
        router.refresh();
      }
    });
  }

  if (message) {
    return (
      <p
        role={failed ? "alert" : "status"}
        className={`text-sm ${failed ? "text-red-700" : "text-body"}`}
      >
        {message}
      </p>
    );
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="text-sm font-medium text-muted underline-offset-2 hover:text-navy hover:underline"
      >
        Cancel
      </button>
    );
  }

  return (
    <div className="mt-2 w-full rounded-xl bg-panel p-4">
      <p className="text-sm leading-relaxed text-body">
        {feeCents > 0 ? (
          <>
            This is inside 48 hours, so a{" "}
            <strong>{formatCents(feeCents)} late cancellation fee</strong> applies.{" "}
            {refundCents > 0
              ? `You get ${formatCents(refundCents)} back.`
              : "There is nothing left to refund."}
          </>
        ) : (
          <>
            You get the full <strong>{formatCents(refundCents)}</strong> back. Refunds
            take a few working days to reach your card.
          </>
        )}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={cancel}
          disabled={pending}
          className="rounded-full bg-red-600 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-700 disabled:opacity-50"
        >
          {pending ? "Cancelling…" : "Yes, cancel it"}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          disabled={pending}
          className="rounded-full border border-hairline px-5 py-2 text-sm font-medium text-body"
        >
          Keep it
        </button>
      </div>
    </div>
  );
}
