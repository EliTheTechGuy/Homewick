"use client";

import { useEffect, useState, useTransition } from "react";
import { requestLoginLink } from "@/actions/account";

export function SignInForm({ linkExpired = false }: { linkExpired?: boolean }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  // Same hydration guard as the booking form: an inert button beats a native
  // submit that puts the address in the query string.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = new FormData(event.currentTarget).get("email");
    setResult(null);
    startTransition(async () => setResult(await requestLoginLink(email)));
  }

  return (
    <div className="max-w-md">
      <h1 className="text-3xl font-semibold text-navy md:text-4xl">My account</h1>
      <p className="mt-4 leading-relaxed text-muted">
        Enter the email you booked with and we will send you a link to sign in. There is
        no password to remember.
      </p>

      {linkExpired && (
        <p className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          That sign-in link has expired or was already used. Links last 15 minutes, so
          ask for a fresh one below.
        </p>
      )}

      {result?.ok ? (
        <div className="mt-8 rounded-2xl border border-hairline bg-panel p-6">
          <h2 className="font-semibold text-navy">Check your email</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted">{result.message}</p>
          <button
            type="button"
            onClick={() => setResult(null)}
            className="mt-4 text-sm font-medium text-accent hover:underline"
          >
            Use a different email
          </button>
        </div>
      ) : (
        <form onSubmit={onSubmit} method="post" className="mt-8">
          <label className="block">
            <span className="text-sm font-medium text-body">Email</span>
            <input
              name="email"
              type="email"
              required
              autoComplete="email"
              placeholder="you@example.com"
              className="mt-2 w-full rounded-xl border border-hairline bg-white px-4 py-3 text-body"
            />
          </label>

          {result && !result.ok && (
            <p className="mt-3 text-sm text-red-700">{result.message}</p>
          )}

          <button
            type="submit"
            disabled={pending || !hydrated}
            className="mt-5 w-full rounded-full bg-accent px-6 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-accent-dark disabled:opacity-60"
          >
            {pending ? "Sending…" : "Email me a sign-in link"}
          </button>
        </form>
      )}

      <p className="mt-8 text-sm leading-relaxed text-muted">
        Accounts are created when you book, so there is nothing separate to sign up for. If
        the email does not arrive, check your spam folder.
      </p>
    </div>
  );
}
