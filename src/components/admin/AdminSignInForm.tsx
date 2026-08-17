"use client";

import { useState, useTransition } from "react";
import { requestAdminLink } from "@/actions/admin-session";

export function AdminSignInForm() {
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, startTransition] = useTransition();

  if (result?.ok) {
    return (
      <p role="status" className="mt-8 rounded-xl bg-panel px-4 py-3 text-body">
        {result.message}
      </p>
    );
  }

  return (
    <form
      action={(formData) =>
        startTransition(async () => setResult(await requestAdminLink(formData)))
      }
      className="mt-8"
    >
      <label className="block text-sm">
        <span className="font-medium text-body">Email</span>
        <input
          name="email"
          type="email"
          required
          autoComplete="email"
          className="mt-1.5 w-full rounded-xl border border-hairline bg-white px-4 py-3 text-body"
        />
      </label>

      {result && !result.ok && (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {result.message}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="mt-5 w-full rounded-full bg-accent px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-accent-dark disabled:opacity-60"
      >
        {pending ? "Sending…" : "Email me a sign-in link"}
      </button>
    </form>
  );
}
