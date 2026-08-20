"use client";

import { useState, useTransition } from "react";
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
  const [intervalDays, setIntervalDays] = useState(21);
  const [entryMethod, setEntryMethod] = useState("none");
  const [propertyKind, setPropertyKind] = useState<"apartment" | "house">("apartment");
  const [result, setResult] = useState<{
    ok: boolean;
    message: string;
    url?: string;
  } | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(data: FormData) {
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
        unitSize: String(data.get("unitSize") ?? ""),
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
        // Entered in dollars because that is how the conversation happened.
        // Rounded rather than truncated so 129.99 does not quietly become
        // 129.98.
        amountCents: Number.isFinite(dollars) ? Math.round(dollars * 100) : 0,
        intervalDays: plan === "recurring" ? intervalDays : undefined,
        visitsPerPeriod: plan === "recurring" ? Number(data.get("visitsPerPeriod")) : undefined,
        notes: String(data.get("notes") ?? ""),
      });
      setResult({
        ok: res.ok,
        message: res.message,
        url: res.ok ? res.checkoutUrl : undefined,
      });
    });
  }

  return (
    <form action={submit} className="mt-8 space-y-8">
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
          <Label label="Apartment or unit">
            <input name="line2" className={field} />
          </Label>
          <Label label="City">
            <input name="city" required className={field} />
          </Label>
          <Label label="ZIP">
            <input name="postalCode" required className={field} />
          </Label>
          <Label label={propertyKind === "house" ? "Nearest bracket" : "Size"}>
            <select name="unitSize" className={field} defaultValue="2br_2ba">
              {UNIT_SIZES.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.label}
                </option>
              ))}
            </select>
          </Label>
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
              onClick={() => setPlan(p)}
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

      {result && (
        <div
          role="status"
          className={
            result.ok
              ? "rounded-2xl border border-hairline bg-panel p-5"
              : "rounded-2xl border border-red-200 bg-red-50 p-5"
          }
        >
          <p className={result.ok ? "text-body" : "text-red-800"}>{result.message}</p>
          {result.url && (
            <>
              <p className="mt-4 text-xs uppercase tracking-widest text-muted">
                Send them this
              </p>
              <p className="mt-1 break-all font-mono text-sm text-navy">{result.url}</p>
              <p className="mt-3 text-sm text-muted">
                Nothing is scheduled until they pay. The link takes their card and the
                booking activates on its own.
              </p>
            </>
          )}
        </div>
      )}
    </form>
  );
}
