"use client";

import { useTransition } from "react";
import { signOutAdmin } from "@/actions/admin-session";

/**
 * Ends the session server side rather than only clearing the cookie, so a
 * copied cookie stops working too.
 */
export function AdminSignOut() {
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => startTransition(async () => { await signOutAdmin(); })}
      className="font-medium text-accent hover:underline disabled:opacity-60"
    >
      {pending ? "Signing out…" : "Sign out"}
    </button>
  );
}
