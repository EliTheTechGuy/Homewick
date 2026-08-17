"use client";

import { useState, useTransition } from "react";
import { signInAdmin } from "@/actions/admin-session";

export function AdminSignInForm() {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form
      action={(formData) =>
        startTransition(async () => {
          const result = await signInAdmin(formData);
          if (result && "error" in result) setError(result.error);
        })
      }
      className="mt-8 space-y-4"
    >
      <label className="block text-sm">
        <span className="font-medium text-body">Email</span>
        <input
          name="email"
          type="email"
          required
          autoComplete="username"
          className="mt-1.5 w-full rounded-xl border border-hairline bg-white px-4 py-3 text-body"
        />
      </label>

      <label className="block text-sm">
        <span className="font-medium text-body">Password</span>
        <input
          name="password"
          type="password"
          required
          autoComplete="current-password"
          className="mt-1.5 w-full rounded-xl border border-hairline bg-white px-4 py-3 text-body"
        />
      </label>

      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-full bg-accent px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-accent-dark disabled:opacity-60"
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>

      <p className="pt-2 text-xs leading-relaxed text-muted">
        There is no reset link, on purpose: one would mean anybody who reached
        your inbox could reach admin. If you are locked out, reset it from the
        command line where the database credentials live.
      </p>
    </form>
  );
}
