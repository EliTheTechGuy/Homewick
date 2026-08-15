"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { completeSignIn } from "@/actions/account";

/**
 * The button that actually signs a member in.
 *
 * Sign in happens on submit, never on page load. A link scanner fetching this
 * page reads some markup and leaves the token untouched.
 */
export function ConfirmSignIn({ token }: { token: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);

  function confirm() {
    setError(null);
    startTransition(async () => {
      const result = await completeSignIn(token);
      if (result.ok) {
        router.replace("/account");
        router.refresh();
      } else {
        setError(result.message);
      }
    });
  }

  if (!token) {
    return (
      <div className="max-w-md">
        <h1 className="text-3xl font-semibold text-navy">Something is missing</h1>
        <p className="mt-4 leading-relaxed text-muted">
          That link is incomplete. Ask for a fresh one and it will only take a moment.
        </p>
        <Link
          href="/account"
          className="mt-6 inline-flex rounded-full bg-accent px-6 py-3 text-sm font-semibold text-white"
        >
          Get a new link
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-md">
      <h1 className="text-3xl font-semibold text-navy md:text-4xl">
        {error ? "That link has expired" : "One more tap"}
      </h1>

      {error ? (
        <>
          <p className="mt-4 leading-relaxed text-muted">{error}</p>
          <Link
            href="/account"
            className="mt-6 inline-flex rounded-full bg-accent px-6 py-3 text-sm font-semibold text-white"
          >
            Send me a new link
          </Link>
        </>
      ) : (
        <>
          <p className="mt-4 leading-relaxed text-muted">
            Confirm it is you and we will open your account.
          </p>
          <button
            type="button"
            onClick={confirm}
            disabled={pending || !hydrated}
            className="mt-6 w-full rounded-full bg-accent px-6 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-accent-dark disabled:opacity-60"
          >
            {pending ? "Signing you in…" : "Sign in to my account"}
          </button>
          <p className="mt-6 text-sm leading-relaxed text-muted">
            This extra tap keeps your link working. Some email providers open links
            automatically to scan them, and without it that check would use up your
            link before you got to it.
          </p>
        </>
      )}
    </div>
  );
}
