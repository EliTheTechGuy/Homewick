"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { sendCardLink } from "@/actions/save-card-link";

/**
 * Ask a customer to put a card on file for a job already on the board.
 *
 * No confirm step, same as the payment link. Sending it twice is not a
 * mistake, and "it never arrived" is the most likely reason anybody presses
 * this at all.
 */
export function SendCardLink({ visitId }: { visitId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  function send() {
    setMessage(null);
    startTransition(async () => {
      const result = await sendCardLink({ visitId });
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
        {pending ? "Sending…" : "Send card link"}
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
