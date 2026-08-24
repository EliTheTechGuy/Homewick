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

  const { refundCents, feeCents, tier } = visit.cancellation;

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
      {/* Three outcomes, each said plainly with the reason attached. The one
          that refunds nothing is the one worth writing carefully: somebody
          who taps through it without understanding is somebody who calls the
          bank rather than us. */}
      <p className="text-sm leading-relaxed text-body">
        {tier === "free" && (
          <>
            You get the full <strong>{formatCents(refundCents)}</strong> back. Refunds
            take a few working days to reach your card.
          </>
        )}
        {tier === "half" && (
          <>
            This is inside 48 hours, so half the price is kept and{" "}
            <strong>{formatCents(refundCents)}</strong> comes back to you. Cancel more
            than 48 hours ahead next time and there is no fee at all.
          </>
        )}
        {tier === "full" && (
          <>
            This is inside 24 hours, so <strong>there is no refund</strong>. The
            cleaner is already booked for it and the slot cannot be filled this late.
            If something has gone wrong, keep the booking and get in touch instead.
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
