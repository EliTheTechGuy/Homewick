"use client";

import { useRef, useState, useTransition } from "react";
import { submitEnquiry } from "@/actions/enquiry";
import { HONEYPOT_FIELD } from "@/lib/enquiry-guard";

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
  const errorRef = useRef<HTMLParagraphElement>(null);

  /**
   * Scrolling moves the page but leaves the cursor where it was, so somebody
   * on a screen reader was told nothing. Deferred a frame because the banner
   * does not exist until the state that renders it has committed.
   */
  function focusError() {
    requestAnimationFrame(() => {
      errorRef.current?.focus();
      errorRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  }

  if (done) {
    return (
      <div role="status" className="rounded-2xl border border-hairline bg-panel p-6">
        <h3 className="text-lg font-semibold text-navy">Thanks, we have got it</h3>
        <p className="mt-3 leading-relaxed text-body">{done}</p>
      </div>
    );
  }

  return (
    <form
      action={(data) =>
        startTransition(async () => {
          const res = await submitEnquiry(data);
          if (res.ok) {
            setDone(res.message);
          } else {
            setError(res.message);
            focusError();
          }
        })
      }
      /* Native validation blocks the submit and jumps to the first empty
         field, showing a bubble that vanishes. Somebody who has just typed
         out their address deserves to be told what is wrong. */
      onInvalid={() => {
        setError("Something is still missing.");
        focusError();
      }}
      /* And the offending fields go red, the way they do everywhere else.
         :user-invalid only matches after somebody has interacted, so nothing
         is red before it has been earned. */
      className="space-y-5 [&_:user-invalid]:border-red-500 [&_:user-invalid]:bg-red-50"
    >
      {error && (
        <p
          ref={errorRef}
          role="alert"
          tabIndex={-1}
          className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 outline-none"
        >
          {error}
        </p>
      )}

      {/* Not a real field. A script filling in everything it can find gives
          itself away here, and the submission is dropped without telling it
          why. Positioned off screen rather than display:none, because some
          form fillers skip anything actually hidden.

          aria-hidden and tabIndex keep it away from anybody using a keyboard
          or a screen reader, and autocomplete="off" stops a password manager
          filling it and locking a real customer out of the form. */}
      <div aria-hidden="true" className="absolute left-[-9999px] top-auto h-px w-px overflow-hidden">
        <label htmlFor={HONEYPOT_FIELD}>Company</label>
        <input
          id={HONEYPOT_FIELD}
          name={HONEYPOT_FIELD}
          type="text"
          tabIndex={-1}
          autoComplete="off"
        />
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <Label label="Your full name">
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

      {/* Square footage only. Bedroom and bathroom counts were asked for and
          then ignored, since the price comes off square footage, and every
          field that does not change the answer is somewhere a person can
          decide the form is too much effort. */}
      <Label label="Square feet" hint="A rough guess is fine, and you can leave it blank.">
        <input name="squareFeet" type="number" min={100} max={30000} className={field} />
      </Label>

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
