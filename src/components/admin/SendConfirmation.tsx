"use client";

import { useState, useTransition } from "react";
import { sendBookingConfirmation } from "@/actions/send-confirmation";

/**
 * Send the customer their details again.
 *
 * No confirm step. Sending somebody the date of their own cleaning a second
 * time is not a mistake worth guarding against, and "I never got anything" is
 * the most likely reason anybody presses it.
 */
export function SendConfirmation({ visitId }: { visitId: string }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setMessage(null);
            const result = await sendBookingConfirmation(visitId);
            setFailed(!result.ok);
            setMessage(result.message);
          })
        }
        className="rounded-full border border-hairline px-4 py-1.5 text-sm font-medium text-body transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
      >
        {pending ? "Sending…" : "Send confirmation"}
      </button>
      {message && (
        <span
          role={failed ? "alert" : "status"}
          className={`text-sm ${failed ? "text-red-700" : "text-muted"}`}
        >
          {message}
        </span>
      )}
    </span>
  );
}
