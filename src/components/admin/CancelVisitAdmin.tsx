"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cancelVisitAsAdmin } from "@/actions/cancel-visit";

/**
 * Calling off a booking on somebody's behalf, usually after a phone call.
 *
 * The refund is worked out server side rather than offered as a choice here.
 * A fee applied by hand is a fee applied differently every time, and the first
 * customer who compares notes with another one is a complaint. If a particular
 * case deserves the fee waived, waive it in Stripe where the exception is
 * visible, rather than making every cancellation a judgement call.
 */
export function CancelVisitAdmin({ visitId }: { visitId: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();

  function cancel() {
    startTransition(async () => {
      const result = await cancelVisitAsAdmin(visitId);
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
      <span
        role={failed ? "alert" : "status"}
        className={`text-sm ${failed ? "text-red-700" : "text-body"}`}
      >
        {message}
      </span>
    );
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="text-sm font-medium text-muted hover:text-red-700"
      >
        Cancel and refund
      </button>
    );
  }

  return (
    <span className="flex items-center gap-2">
      <button
        type="button"
        onClick={cancel}
        disabled={pending}
        className="rounded-full bg-red-600 px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
      >
        {pending ? "Cancelling…" : "Confirm"}
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
