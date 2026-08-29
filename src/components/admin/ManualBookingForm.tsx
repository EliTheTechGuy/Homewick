"use client";

import { useRef, useState, useTransition } from "react";
import { createManualBooking } from "@/actions/manual-booking";
import { SERVICE_TYPES, UNIT_SIZES } from "@/lib/pricing";

/**
 * Entering somebody who did not come through the booking form.
 *
 * The cadence is offered as presets plus a free number, because "every three
 * weeks" is the case that prompted this and the next odd one will be different
 * again. Days rather than weeks so there is one unit and nothing to convert.
 */
const CADENCES = [
  { days: 7, label: "Weekly" },
  { days: 14, label: "Every 2 weeks" },
  { days: 21, label: "Every 3 weeks" },
  { days: 28, label: "Every 4 weeks" },
];

const field =
  "mt-1.5 w-full rounded-xl border border-hairline bg-white px-4 py-2.5 text-body";

function Label({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <label className="block text-sm">
      <span className="font-medium text-body">{label}</span>
      {children}
    </label>
  );
}

export function ManualBookingForm() {
  const [plan, setPlan] = useState<"single" | "recurring">("recurring");
  const [paymentTerms, setPaymentTerms] = useState<
    "on_booking" | "later" | "card_on_file"
  >("on_booking");
  const [intervalDays, setIntervalDays] = useState(21);
  const [entryMethod, setEntryMethod] = useState("none");
  const [propertyKind, setPropertyKind] = useState<"apartment" | "house">("apartment");
  const [result, setResult] = useState<{
    ok: boolean;
    message: string;
    url?: string;
    emailed?: boolean;
  } | null>(null);
  const [missing, setMissing] = useState(false);
  const [pending, startTransition] = useTransition();
  const bannerRef = useRef<HTMLDivElement>(null);

  /**
   * Take the reader to the answer, not just to the top of the page.
   *
   * Deferred a frame because the banner does not exist until the state that
   * renders it has committed. Focus as well as scroll, since scrolling moves
   * the viewport but leaves the cursor where it was, which tells somebody on a
   * screen reader nothing at all.
   */
  function showBanner() {
    requestAnimationFrame(() => {
      bannerRef.current?.focus();
      bannerRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  }

  function submit(data: FormData) {
    setMissing(false);
    startTransition(async () => {
      const dollars = Number(data.get("amount"));
      const res = await createManualBooking({
        firstName: String(data.get("firstName") ?? ""),
        lastName: String(data.get("lastName") ?? ""),
        email: String(data.get("email") ?? ""),
        phone: String(data.get("phone") ?? ""),
        line1: String(data.get("line1") ?? ""),
        line2: String(data.get("line2") ?? ""),
        city: String(data.get("city") ?? ""),
        postalCode: String(data.get("postalCode") ?? ""),
        unitSize: propertyKind === "apartment" ? String(data.get("unitSize") ?? "") : undefined,
        propertyKind,
        bedrooms: propertyKind === "house" ? Number(data.get("bedrooms")) || undefined : undefined,
        bathrooms: propertyKind === "house" ? Number(data.get("bathrooms")) || undefined : undefined,
        squareFeet: propertyKind === "house" ? Number(data.get("squareFeet")) || undefined : undefined,
        hasPets: data.get("hasPets") === "on",
        entryMethod,
        entryDetail: String(data.get("entryDetail") ?? ""),
        plan,
        serviceType: String(data.get("serviceType") ?? ""),
        startsOn: String(data.get("startsOn") ?? ""),
        startsAt: String(data.get("startsAt") ?? "09:00"),
        // Entered in dollars because that is how the conversation happened.
        // Rounded rather than truncated so 129.99 does not quietly become
        // 129.98.
        amountCents: Number.isFinite(dollars) ? Math.round(dollars * 100) : 0,
        intervalDays: plan === "recurring" ? intervalDays : undefined,
        visitsPerPeriod: plan === "recurring" ? Number(data.get("visitsPerPeriod")) : undefined,
        notes: String(data.get("notes") ?? ""),
        paymentTerms,
      });
      setResult({
        ok: res.ok,
        message: res.message,
        url: res.ok ? res.checkoutUrl : undefined,
        emailed: res.ok ? res.emailed : undefined,
      });
      showBanner();
    });
  }

  return (
    <form
      action={submit}
      /* Native validation blocks the submit and jumps to the first empty
         field, showing a bubble that disappears the moment you look away. So
         the page moved and nothing explained why. This fires for each invalid
         field; the flag is enough, the browser still highlights which one. */
      onInvalid={() => {
        setResult(null);
        setMissing(true);
      }}
      /* Refused fields go red, the way they do everywhere else.
         :user-invalid only matches after somebody has interacted, so nothing
         is red before it has been earned. */
      className={
        missing
          ? "mt-8 space-y-8 [&_:user-invalid]:border-red-500 [&_:user-invalid]:bg-red-50"
          : "mt-8 space-y-8"
      }
    >
      {/* At the top, because the button is at the bottom of a long form and an
          answer rendered underneath it is an answer nobody scrolls back to. */}
      {(missing || result) && (
        <div
          ref={bannerRef}
          tabIndex={-1}
          role={result && !result.ok ? "alert" : "status"}
          className={
            missing || (result && !result.ok)
              ? "rounded-2xl border border-red-200 bg-red-50 p-5 outline-none"
              : "rounded-2xl border border-hairline bg-panel p-5 outline-none"
          }
        >
          {missing ? (
            <p className="text-red-800">
              Some details are still missing.
            </p>
          ) : (
            <>
              <p className={result!.ok ? "text-body" : "text-red-800"}>
                {result!.message}
              </p>
              {result!.url && (
                <>
                  <p className="mt-3 text-sm text-muted">
                    Nothing is scheduled until they pay. The link takes their card and
                    the booking activates on its own. It is good for 24 hours, which is
                    the longest Stripe allows.
                  </p>
                  {/* Behind a fold when the email went, because the flow is
                      that we send it, not that you forward it. Still here for
                      the call where somebody would rather have it by text, and
                      open by default when the email did not go at all. */}
                  <details className="mt-4" open={result!.emailed === false}>
                    <summary className="cursor-pointer text-xs uppercase tracking-widest text-muted">
                      {result!.emailed ? "Copy the link instead" : "Send them this"}
                    </summary>
                    <p className="mt-2 break-all font-mono text-sm text-navy">
                      {result!.url}
                    </p>
                  </details>
                </>
              )}
            </>
          )}
        </div>
      )}

      <section>
        <h2 className="text-lg font-semibold text-navy">Customer</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Label label="First name">
            <input name="firstName" required className={field} />
          </Label>
          <Label label="Last name">
            <input name="lastName" required className={field} />
          </Label>
          <Label label="Email">
            <input name="email" type="email" required className={field} />
          </Label>
          <Label label="Phone">
            <input name="phone" required className={field} />
          </Label>
        </div>
        <p className="mt-2 text-xs text-muted">
          If this email is already on file, the existing customer is used rather than
          a second one created.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-navy">Property</h2>

        {/* This is not cosmetic: it decides which pay model the crew on every
            visit here is paid under. A house splits half the price across the
            crew with a lead premium; an apartment pays one cleaner their own
            percentage. */}
        <div className="mt-4 flex gap-2">
          {(["apartment", "house"] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setPropertyKind(k)}
              className={
                propertyKind === k
                  ? "rounded-full bg-navy px-4 py-2 text-sm font-semibold text-white"
                  : "rounded-full border border-hairline px-4 py-2 text-sm font-medium text-muted"
              }
            >
              {k === "apartment" ? "Apartment" : "House"}
            </button>
          ))}
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Label label="Street address">
            <input name="line1" required className={field} />
          </Label>
          <Label label={propertyKind === "house" ? "Unit or suite, if any" : "Apartment or unit"}>
            <input name="line2" className={field} />
          </Label>
          <Label label="City">
            <input name="city" required className={field} />
          </Label>
          <Label label="ZIP">
            <input name="postalCode" required className={field} />
          </Label>
          {/* Apartments only. A house has no bracket, and asking which one it
              is nearest is a question with no true answer: a 7 bed is not near
              any of them, and whatever got picked was then stored as a fact. */}
          {propertyKind === "apartment" && (
            <Label label="Size">
              <select name="unitSize" className={field} defaultValue="2br_2ba" required>
                {UNIT_SIZES.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.label}
                  </option>
                ))}
              </select>
            </Label>
          )}
          {propertyKind === "house" && (
            <>
              <Label label="Bedrooms">
                <input name="bedrooms" type="number" min={0} max={20} className={field} />
              </Label>
              <Label label="Bathrooms">
                <input
                  name="bathrooms"
                  type="number"
                  min={0}
                  max={20}
                  step="0.5"
                  placeholder="3.5"
                  className={field}
                />
              </Label>
              <Label label="Square feet">
                <input name="squareFeet" type="number" min={100} max={30000} className={field} />
              </Label>
            </>
          )}

          <label className="flex items-end gap-2 pb-2 text-sm">
            <input name="hasPets" type="checkbox" className="h-4 w-4" />
            <span className="text-body">Pets in the home</span>
          </label>
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-navy">Getting in</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Label label="Method">
            <select
              value={entryMethod}
              onChange={(e) => setEntryMethod(e.target.value)}
              className={field}
            >
              <option value="none">Somebody will be home</option>
              <option value="door_code">Door code</option>
              <option value="gate_code">Gate code</option>
              <option value="key_location">Key location</option>
            </select>
          </Label>
          {entryMethod !== "none" && (
            <Label label="Detail">
              <input name="entryDetail" className={field} />
            </Label>
          )}
        </div>
        <p className="mt-2 text-xs text-muted">
          Stored encrypted, separately from everything else, and only readable on the
          day of a visit by the cleaner assigned to it.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-navy">The work</h2>

        <div className="mt-4 flex gap-2">
          {(["recurring", "single"] as const).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => {
                setPlan(p);
                // Card on file is a single-visit choice. Leaving it selected
                // while the option disappears would submit a booking the
                // server refuses, with nothing on screen explaining why.
                if (p === "recurring" && paymentTerms === "card_on_file") {
                  setPaymentTerms("on_booking");
                }
              }}
              className={
                plan === p
                  ? "rounded-full bg-navy px-4 py-2 text-sm font-semibold text-white"
                  : "rounded-full border border-hairline px-4 py-2 text-sm font-medium text-muted"
              }
            >
              {p === "recurring" ? "Repeating" : "One visit"}
            </button>
          ))}
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Label label="Service">
            <select name="serviceType" className={field} defaultValue="standard">
              {SERVICE_TYPES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </Label>
          <Label label={plan === "recurring" ? "First clean on" : "Date"}>
            <input name="startsOn" type="date" required className={field} />
          </Label>
          {/* Asked rather than assumed. Everything used to be nine in the
              morning because nothing ever asked, so a time agreed on the
              phone went into the notes and the cleaner's page then disagreed
              with itself. */}
          <Label label="Arriving at">
            <input
              name="startsAt"
              type="time"
              defaultValue="09:00"
              required
              className={field}
            />
            <span className="mt-1 block text-xs text-muted">
              {plan === "recurring"
                ? "Every cleaning on this schedule starts here."
                : "What the cleaner is told, and what the customer is told."}
            </span>
          </Label>

          {plan === "recurring" && (
            <>
              <Label label="How often">
                <select
                  value={intervalDays}
                  onChange={(e) => setIntervalDays(Number(e.target.value))}
                  className={field}
                >
                  {CADENCES.map((c) => (
                    <option key={c.days} value={c.days}>
                      {c.label}
                    </option>
                  ))}
                  {!CADENCES.some((c) => c.days === intervalDays) && (
                    <option value={intervalDays}>Every {intervalDays} days</option>
                  )}
                </select>
                <input
                  type="number"
                  min={7}
                  max={365}
                  value={intervalDays}
                  onChange={(e) => setIntervalDays(Number(e.target.value))}
                  className={`${field} mt-2`}
                  aria-label="Or enter days between cleans"
                />
                <span className="mt-1 block text-xs text-muted">
                  Days between cleans. Anything from 7 to 365.
                </span>
              </Label>
              <Label label="Cleans per billing cycle">
                <input
                  name="visitsPerPeriod"
                  type="number"
                  min={1}
                  max={10}
                  defaultValue={1}
                  className={field}
                />
              </Label>
            </>
          )}

          <Label label={plan === "recurring" ? "Charge each cycle" : "Price"}>
            <input
              name="amount"
              type="number"
              min={1}
              step="0.01"
              required
              placeholder="145.00"
              className={field}
            />
            <span className="mt-1 block text-xs text-muted">
              Dollars. No published rate applies here, so this is whatever you agreed.
            </span>
          </Label>
        </div>

        <Label label="Notes for the cleaner">
          <textarea name="notes" rows={3} className={`${field} mt-4`} />
        </Label>

        {/* Nothing about this is scheduling. It decides whether the job goes
            on the board now or waits behind a payment, which is the whole
            difference between somebody you can staff and somebody you cannot. */}
        <fieldset className="mt-6">
          <legend className="text-sm font-medium text-body">The payment link</legend>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {(
              [
                {
                  id: "on_booking" as const,
                  title: "Send it now",
                  body: "They pay before anything is scheduled. This is the normal way.",
                },
                {
                  id: "later" as const,
                  title: "I will send it later",
                  body: "The job goes on the board straight away so you can assign cleaners. Send the link from their record when you are ready.",
                },
                // Hidden on a repeating booking rather than shown and refused.
                // A subscription already keeps a card and charges it, so the
                // choice would be between one thing and the same thing.
                ...(plan === "single"
                  ? [
                      {
                        id: "card_on_file" as const,
                        title: "Card on file, charge on the day",
                        body: "They add a card now and are not charged. The job goes on the board, and you take the money with a button on the morning of the clean.",
                      },
                    ]
                  : []),
              ]
            ).map((o) => (
              <label
                key={o.id}
                className={`cursor-pointer rounded-xl border p-4 transition-colors ${
                  paymentTerms === o.id
                    ? "border-accent bg-accent/5"
                    : "border-hairline hover:border-accent/40"
                }`}
              >
                <span className="flex items-start gap-3">
                  <input
                    type="radio"
                    name="paymentTermsChoice"
                    checked={paymentTerms === o.id}
                    onChange={() => setPaymentTerms(o.id)}
                    className="mt-1 h-4 w-4 accent-[#1F5FA6]"
                  />
                  <span>
                    <span className="block text-sm font-medium text-body">{o.title}</span>
                    <span className="mt-1 block text-xs leading-relaxed text-muted">
                      {o.body}
                    </span>
                  </span>
                </span>
              </label>
            ))}
          </div>
          {paymentTerms === "card_on_file" && (
            <p className="mt-3 text-sm text-muted">
              They get one email with the cleaning details and a link to add a card.
              Nothing is charged until you press Charge card on the booking, and the
              email tells them the amount and that it comes out on the morning of the
              clean.
            </p>
          )}
          {paymentTerms === "later" && (
            <p className="mt-3 text-sm text-muted">
              Nothing is charged and nothing is sent. You are agreeing to do the work
              before being paid for it, so it will show as unpaid on the schedule until
              they settle it.
            </p>
          )}
        </fieldset>
      </section>

      <div className="flex items-center gap-4">
        <button
          type="submit"
          disabled={pending}
          className="rounded-full bg-accent px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-accent-dark disabled:opacity-60"
        >
          {pending ? "Saving…" : "Create and get payment link"}
        </button>
      </div>

    </form>
  );
}
