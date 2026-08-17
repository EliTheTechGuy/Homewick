"use client";

import { useState, useTransition } from "react";
import { completeAdminSignIn } from "@/actions/admin-session";

/** The click spends the link, not the page load. See the page comment. */
export function ConfirmAdminSignIn({ token }: { token: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="mt-8">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await completeAdminSignIn(token);
            if (result && "error" in result) setError(result.error);
          })
        }
        className="w-full rounded-full bg-accent px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-accent-dark disabled:opacity-60"
      >
        {pending ? "Signing in…" : "Sign in to admin"}
      </button>
      {error && (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
