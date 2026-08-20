"use client";

import { useState, useTransition } from "react";
import { submitEnquiry } from "@/actions/enquiry";

const field =
  "mt-1.5 w-full rounded-xl border border-hairline bg-white px-4 py-3 text-body";

function Label({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="font-medium text-body">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

/**
 * Only name, email and phone are required. Everything else helps us quote
 * faster but asking for it as a condition loses people who do not know their
 * square footage off the top of their head, which is most of them.
 */
export function EnquiryForm() {
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (done) {
    return (
      <div role="status" className="rounded-2xl border border-hairline bg-panel p-6">
        <h3 className="text-lg font-semibold text-navy">Request sent</h3>
        <p className="mt-2 leading-relaxed text-body">{done}</p>
      </div>
    );
  }

  return (
    <form
      action={(data) =>
        startTransition(async () => {
          const res = await submitEnquiry(data);
          if (res.ok) setDone(res.message);
          else setError(res.message);
        })
      }
      className="space-y-5"
    >
      <div className="grid gap-5 sm:grid-cols-2">
        <Label label="Your name">
          <input name="name" required className={field} />
        </Label>
        <Label label="Phone">
          <input name="phone" required className={field} />
        </Label>
      </div>

      <Label label="Email">
        <input name="email" type="email" required className={field} />
      </Label>

      <Label label="Address" hint="Optional, but it helps us check we cover you.">
        <input name="address" className={field} />
      </Label>

      <div className="grid gap-5 sm:grid-cols-3">
        <Label label="Square feet" hint="A rough guess is fine.">
          <input name="squareFeet" type="number" min={100} max={30000} className={field} />
        </Label>
        <Label label="Bedrooms">
          <input name="bedrooms" type="number" min={0} max={20} className={field} />
        </Label>
        <Label label="Bathrooms">
          <input name="bathrooms" type="number" min={0} max={20} className={field} />
        </Label>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <Label label="What kind of clean">
          <select name="serviceType" defaultValue="not_sure" className={field}>
            <option value="not_sure">Not sure yet</option>
            <option value="standard">Standard</option>
            <option value="deep">Deep clean</option>
            <option value="move_out">Move in or out</option>
          </select>
        </Label>
        <Label label="How often" hint="One off, monthly, every few weeks, whatever suits.">
          <input name="frequency" placeholder="e.g. every 3 weeks" className={field} />
        </Label>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input name="hasPets" type="checkbox" className="h-4 w-4" />
        <span className="text-body">There are pets in the home</span>
      </label>

      <Label label="Anything else we should know">
        <textarea name="message" rows={4} className={field} />
      </Label>

      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="rounded-full bg-accent px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-accent-dark disabled:opacity-60"
      >
        {pending ? "Sending…" : "Request a quote"}
      </button>
      <p className="text-xs text-muted">
        No payment now, and no obligation. We reply with a price and you decide.
      </p>
    </form>
  );
}
