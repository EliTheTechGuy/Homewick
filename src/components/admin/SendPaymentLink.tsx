"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { sendPaymentLink } from "@/actions/send-payment-link";

/**
 * Ask for the money on a job that was agreed before it was paid for.
 *
 * No confirm step. Sending somebody a payment link a second time is not a
 * mistake worth guarding against, and the customer saying it never arrived is
 * the most likely reason anybody presses this at all.
 */
export function SendPaymentLink({
  kind,
  id,
  label = "Send payment link",
}: {
  kind: "membership" | "one_time";
  id: string;
  label?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  function send() {
    setMessage(null);
    startTransition(async () => {
      const result = await sendPaymentLink({ kind, id });
      setFailed(!result.ok);
      setMessage(result.message);
      if (result.ok) router.refresh();
    });
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={send}
        disabled={pending}
        className="rounded-full border border-accent px-4 py-1.5 text-sm font-medium text-accent transition-colors hover:bg-accent hover:text-white disabled:opacity-50"
      >
        {pending ? "Sending…" : label}
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
