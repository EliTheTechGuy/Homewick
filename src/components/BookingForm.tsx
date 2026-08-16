"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { submitBooking } from "@/actions/booking";
import { createCheckoutSession } from "@/actions/checkout";
import { quoteFor } from "@/lib/booking-schema";
import { formatCents } from "@/lib/money";
import { WEEKDAYS, today, addDays, addMonths, formatLong } from "@/lib/dates";
import {
  ADD_ONS,
  FREE_PERK_ELIGIBLE,
  MEMBERSHIP_PRICES,
  PET_SURCHARGE_CENTS,
  SERVICE_TYPES,
  UNIT_SIZES,
  type ServiceType,
  type UnitSize,
} from "@/lib/pricing";

type Plan = "one_time" | "membership";
type EntryMethod = "door_code" | "gate_code" | "key_location" | "front_desk";

const ENTRY_METHODS: {
  id: EntryMethod;
  label: string;
  hint: string;
  /** The label for the detail field, or null when nothing is needed. */
  detailLabel: string | null;
}[] = [
  {
    id: "door_code",
    label: "Door code",
    hint: "The code for your unit's door or smart lock",
    detailLabel: "Door code",
  },
  {
    id: "gate_code",
    label: "Gate code",
    hint: "Community or garage gate code, plus your unit number",
    detailLabel: "Gate code",
  },
  {
    id: "key_location",
    label: "Key location",
    hint: "Lockbox location and code",
    detailLabel: "Where the key is",
  },
  {
    id: "front_desk",
    label: "Someone lets us in",
    hint: "A front desk or concierge, or you'll be home",
    detailLabel: null,
  },
];

export function BookingForm({
  initialPlan,
  initialSize,
}: {
  initialPlan: Plan;
  initialSize: UnitSize;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [plan, setPlan] = useState<Plan>(initialPlan);
  const [unitSize, setUnitSize] = useState<UnitSize>(initialSize);
  const [serviceType, setServiceType] = useState<ServiceType>("standard");
  const [addOns, setAddOns] = useState<string[]>([]);
  const [freePerk, setFreePerk] = useState("");
  const [hasPets, setHasPets] = useState(false);
  const [preferredWeekday, setPreferredWeekday] = useState("4");
  const [preferredDate, setPreferredDate] = useState("");
  const [entryMethod, setEntryMethod] = useState<EntryMethod>("door_code");

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  /**
   * Until React has hydrated, the submit button is inert.
   *
   * Without this, a click landing before hydration falls through to a native
   * form submission. The form has no action, so the browser issues a GET to
   * this same page with every field in the query string, including the door
   * and gate codes, which would then sit in browser history, server access
   * logs, and any referrer header. Entry codes must never reach a URL.
   */
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);

  const detailLabel =
    ENTRY_METHODS.find((m) => m.id === entryMethod)?.detailLabel ?? null;

  const quote = useMemo(
    () =>
      quoteFor({
        plan,
        unitSize,
        serviceType: plan === "one_time" ? serviceType : undefined,
        addOns,
        freePerk: freePerk || undefined,
        hasPets,
      }),
    [plan, unitSize, serviceType, addOns, freePerk, hasPets],
  );

  function toggleAddOn(code: string) {
    setAddOns((current) => {
      const next = current.includes(code)
        ? current.filter((c) => c !== code)
        : [...current, code];
      // Dropping the add-on that was chosen as the free perk clears the perk.
      if (!next.includes(freePerk)) setFreePerk("");
      return next;
    });
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setErrors({});

    const form = new FormData(event.currentTarget);

    // FormData.get returns null for a field that is not currently rendered.
    // The entry code disappears when someone is letting the cleaner in, and
    // the schema's optional() accepts undefined, not null. Coercing here keeps
    // a hidden field from failing validation against an error nobody can see.
    const field = (name: string) => (form.get(name) as string | null) ?? "";

    const payload = {
      firstName: field("firstName"),
      lastName: field("lastName"),
      email: field("email"),
      phone: field("phone"),
      line1: field("line1"),
      line2: field("line2"),
      city: field("city"),
      state: "TX",
      postalCode: field("postalCode"),
      unitSize,
      plan,
      serviceType: plan === "one_time" ? serviceType : undefined,
      addOns,
      freePerk: plan === "membership" ? freePerk : "",
      hasPets,
      preferredWeekday:
        plan === "membership" ? Number(preferredWeekday) : undefined,
      entryMethod,
      entryDetail: field("entryDetail"),
      alarmInstructions: field("alarmInstructions"),
      instructions: field("instructions"),
      preferredDate: plan === "one_time" ? preferredDate : "",
      smsConsent: form.get("smsConsent") === "on",
      acceptTerms: form.get("acceptTerms") === "on",
    };

    startTransition(async () => {
      const result = await submitBooking(payload);

      if (!result.ok) {
        setErrors(result.fieldErrors);

        // A rejection always says something. Field errors normally render
        // beside their input, but an error can land on a field that is not
        // currently on screen, and then the button just appears to do
        // nothing, which is exactly how this went unnoticed once already.
        const issues = Object.entries(result.fieldErrors);
        setFormError(
          result.formError ??
            (issues.length > 0
              ? issues.length === 1
                ? issues[0][1]
                : "Please check the highlighted fields and try again."
              : "That did not go through. Please check your details and try again."),
        );
        window.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }

      // The booking is saved at this point. Payment is collected by Stripe.
      const checkout = await createCheckoutSession(result.bookingRef, result.kind);
      if ("error" in checkout) {
        setFormError(checkout.error);
        window.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }

      if (checkout.url.startsWith("/")) {
        router.push(checkout.url);
      } else {
        window.location.href = checkout.url;
      }
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      // Submission always goes through handleSubmit. method="post" only
      // matters for a native submit that beats hydration, such as pressing
      // Enter in a field, where it keeps the fields in the request body instead
      // of appending them to the URL.
      method="post"
      className="mt-12 grid gap-12 lg:grid-cols-[1fr_20rem]"
    >
      <div className="space-y-12">
        {formError && (
          <p className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            {formError}
          </p>
        )}

        {/* Plan */}
        <Fieldset legend="How would you like to book?">
          <div className="grid gap-3 sm:grid-cols-2">
            <Choice
              selected={plan === "membership"}
              onSelect={() => setPlan("membership")}
              title="Membership"
              body="Two cleanings a month, 15% off every visit, one free add-on each month."
            />
            <Choice
              selected={plan === "one_time"}
              onSelect={() => setPlan("one_time")}
              title="One-time clean"
              body="A single visit at the published rate."
            />
          </div>
        </Fieldset>

        {/* Size */}
        <Fieldset legend="Apartment size" error={errors.unitSize}>
          <div className="grid gap-3 sm:grid-cols-3">
            {UNIT_SIZES.map((s) => (
              <Choice
                key={s.id}
                selected={unitSize === s.id}
                onSelect={() => setUnitSize(s.id)}
                title={s.label}
              />
            ))}
          </div>
          <p className="mt-3 text-sm text-muted">
            Single-family homes are quoted separately by square footage. Pick the closest
            size and tell us in the notes below.
          </p>
        </Fieldset>

        {/* Service */}
        {plan === "one_time" && (
          <Fieldset legend="Service" error={errors.serviceType}>
            <div className="grid gap-3 sm:grid-cols-3">
              {SERVICE_TYPES.map((s) => (
                <Choice
                  key={s.id}
                  selected={serviceType === s.id}
                  onSelect={() => setServiceType(s.id)}
                  title={s.label}
                  body={s.blurb}
                />
              ))}
            </div>
          </Fieldset>
        )}

        {/* Add-ons */}
        <Fieldset legend="Add-ons">
          <div className="grid gap-2 sm:grid-cols-2">
            {ADD_ONS.map((a) => (
              <label
                key={a.code}
                className={`flex cursor-pointer items-center justify-between gap-3 rounded-xl border p-4 transition-colors ${
                  addOns.includes(a.code)
                    ? "border-accent bg-accent/5"
                    : "border-hairline hover:border-accent/40"
                }`}
              >
                <span className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={addOns.includes(a.code)}
                    onChange={() => toggleAddOn(a.code)}
                    className="h-4 w-4 accent-[#1F5FA6]"
                  />
                  <span className="text-sm text-body">{a.name}</span>
                </span>
                <span className="text-sm font-semibold text-accent">
                  {formatCents(a.priceCents)}
                </span>
              </label>
            ))}
          </div>
        </Fieldset>

        {/* Free perk */}
        {plan === "membership" && (
          <Fieldset
            legend="Your free add-on this month"
            error={errors.freePerk}
            hint="Members get one eligible add-on free each period. Choose it now so it reaches your cleaner as part of the assignment."
          >
            <div className="grid gap-2 sm:grid-cols-2">
              {FREE_PERK_ELIGIBLE.map((a) => {
                const selectable = addOns.includes(a.code);
                return (
                  <label
                    key={a.code}
                    className={`flex items-center gap-3 rounded-xl border p-4 transition-colors ${
                      freePerk === a.code
                        ? "border-accent bg-accent/5"
                        : "border-hairline"
                    } ${selectable ? "cursor-pointer" : "opacity-50"}`}
                  >
                    <input
                      type="radio"
                      name="freePerkChoice"
                      checked={freePerk === a.code}
                      disabled={!selectable}
                      onChange={() => setFreePerk(a.code)}
                      className="h-4 w-4 accent-[#1F5FA6]"
                    />
                    <span className="text-sm text-body">{a.name}</span>
                  </label>
                );
              })}
            </div>
            <p className="mt-3 text-sm text-muted">
              Select an add-on above first. Cabinet interiors and laundry are not eligible
              as the free perk.
            </p>
          </Fieldset>
        )}

        {/* Schedule */}
        <Fieldset
          legend="Scheduling"
          error={errors.preferredWeekday ?? errors.preferredDate}
        >
          {plan === "membership" ? (
            <label className="block">
              <span className="text-sm font-medium text-body">Preferred weekday</span>
              <select
                value={preferredWeekday}
                onChange={(e) => setPreferredWeekday(e.target.value)}
                className="mt-2 w-full rounded-xl border border-hairline bg-white px-4 py-3 text-body"
              >
                {WEEKDAYS.map((d) => (
                  <option key={d.value} value={d.value}>
                    {d.label}
                  </option>
                ))}
              </select>
              <span className="mt-2 block text-sm text-muted">
                Your two visits are placed roughly two weeks apart inside each billing
                period. We confirm exact dates by email.
              </span>
            </label>
          ) : (
            <label className="block">
              <span className="text-sm font-medium text-body">Preferred date</span>
              <input
                type="date"
                value={preferredDate}
                min={addDays(today(), 2)}
                onChange={(e) => setPreferredDate(e.target.value)}
                className="mt-2 w-full rounded-xl border border-hairline bg-white px-4 py-3 text-body"
              />
              <span className="mt-2 block text-sm text-muted">
                We confirm the exact time by email before the visit.
              </span>
            </label>
          )}
        </Fieldset>

        {/* Contact */}
        <Fieldset legend="Your details">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field name="firstName" label="First name" error={errors.firstName} required />
            <Field name="lastName" label="Last name" error={errors.lastName} required />
            <Field name="email" label="Email" type="email" error={errors.email} required />
            <Field name="phone" label="Phone" type="tel" error={errors.phone} required />
          </div>
        </Fieldset>

        {/* Property */}
        <Fieldset legend="Where we're cleaning">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              name="line1"
              label="Street address"
              error={errors.line1}
              required
              className="sm:col-span-2"
            />
            <Field name="line2" label="Apartment or unit" error={errors.line2} />
            <Field name="city" label="City" error={errors.city} required />
            <Field name="postalCode" label="ZIP code" error={errors.postalCode} required />
          </div>
          <label className="mt-5 flex cursor-pointer items-center gap-3">
            <input
              type="checkbox"
              checked={hasPets}
              onChange={(e) => setHasPets(e.target.checked)}
              className="h-4 w-4 accent-[#1F5FA6]"
            />
            <span className="text-sm text-body">
              There are pets in the home (one-time {formatCents(PET_SURCHARGE_CENTS)})
            </span>
          </label>
        </Fieldset>

        {/* Entry */}
        {/* The error belongs on the field itself, not repeated on the
            fieldset, because showing both renders it twice. */}
        <Fieldset
          legend="How we get in"
          hint="Entry details are encrypted, stored apart from the rest of your account, and shared only with the cleaner assigned to your visit on the day. Every access is logged."
        >
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {ENTRY_METHODS.map((m) => (
              <Choice
                key={m.id}
                selected={entryMethod === m.id}
                onSelect={() => setEntryMethod(m.id)}
                title={m.label}
                body={m.hint}
              />
            ))}
          </div>
          <div className="mt-4 grid gap-4">
            {/* No code to collect when someone is letting the cleaner in. */}
            {detailLabel ? (
              <Field
                name="entryDetail"
                label={detailLabel}
                error={errors.entryDetail}
                required
              />
            ) : (
              <p className="rounded-xl bg-panel p-4 text-sm leading-relaxed text-muted">
                Nothing needed here. Tell us below who to ask for at the desk, or
                anything else that helps us get to your door.
              </p>
            )}
            <Field name="alarmInstructions" label="Alarm instructions (optional)" />
          </div>
        </Fieldset>

        {/* Notes */}
        <Fieldset legend="Anything else we should know?">
          <textarea
            name="instructions"
            rows={4}
            placeholder="Parking, a room to skip, where supplies live, anything specific."
            className="w-full rounded-xl border border-hairline bg-white px-4 py-3 text-body placeholder:text-muted/70"
          />
        </Fieldset>

        {/* Consent */}
        <Fieldset legend="Consent" error={errors.acceptTerms}>
          <label className="flex cursor-pointer gap-3">
            <input type="checkbox" name="smsConsent" className="mt-1 h-4 w-4 accent-[#1F5FA6]" />
            <span className="text-sm leading-relaxed text-body">
              Text me about my service once texting is available, covering scheduling and
              day-before notices. We do not send texts today, and everything about your
              booking comes by email for now. Message frequency will vary; message and data
              rates may apply. Reply STOP to unsubscribe or HELP for help. Consent is not a
              condition of purchase.
            </span>
          </label>
          <label className="mt-4 flex cursor-pointer gap-3">
            <input type="checkbox" name="acceptTerms" className="mt-1 h-4 w-4 accent-[#1F5FA6]" />
            <span className="text-sm leading-relaxed text-body">
              I accept the{" "}
              <Link href="/terms" target="_blank" className="font-medium text-accent underline">
                service agreement
              </Link>
              , including the membership, cancellation, and laundry terms.
            </span>
          </label>
        </Fieldset>
      </div>

      {/* Summary */}
      <aside className="lg:sticky lg:top-24 lg:self-start">
        <div className="rounded-2xl border border-hairline bg-panel p-6">
          <h2 className="text-lg font-semibold text-navy">Your booking</h2>
          <dl className="mt-5 space-y-3">
            {quote.lines.map((line) => (
              <div key={line.label} className="flex justify-between gap-4 text-sm">
                <dt className="text-body">{line.label}</dt>
                <dd className="shrink-0 font-medium text-navy">
                  {line.amountCents === 0 ? "Free" : formatCents(line.amountCents)}
                </dd>
              </div>
            ))}
          </dl>
          {/* The recurring charge, at the same weight as the total and above it.
              Somebody should not have to reach Stripe, or read the small print,
              to find out what this costs every month. */}
          {plan === "membership" && (
            <div className="mt-5 flex justify-between gap-4 border-t border-hairline pt-4 text-sm">
              <span className="text-body">
                Then every month
                <span className="mt-0.5 block text-xs text-muted">
                  From {formatLong(addMonths(today(), 1))}, until you cancel
                </span>
              </span>
              <span className="shrink-0 font-semibold text-navy">
                {formatCents(MEMBERSHIP_PRICES[unitSize].monthlyCents)}
              </span>
            </div>
          )}

          <div className="mt-5 flex justify-between border-t border-hairline pt-4">
            <span className="font-semibold text-navy">Due today</span>
            <span className="text-xl font-semibold text-accent">
              {formatCents(quote.totalCents)}
            </span>
          </div>
          {plan === "membership" && (
            <p className="mt-4 text-xs leading-relaxed text-muted">
              Two cleanings every month for that price. Cancel any time with 14
              days&apos; notice, from your account or by getting in touch.
            </p>
          )}

          <button
            type="submit"
            disabled={pending || !hydrated}
            className="mt-6 w-full rounded-full bg-accent px-6 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-accent-dark disabled:opacity-60"
          >
            {pending ? "Saving…" : "Continue to payment"}
          </button>
          <p className="mt-3 text-center text-xs text-muted">
            Card details are entered with Stripe. We never see them.
          </p>
        </div>
      </aside>
    </form>
  );
}

function Fieldset({
  legend,
  hint,
  error,
  children,
}: {
  legend: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <fieldset>
      <legend className="text-xl font-semibold text-navy">{legend}</legend>
      {hint && <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted">{hint}</p>}
      <div className="mt-5">{children}</div>
      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
    </fieldset>
  );
}

function Choice({
  selected,
  onSelect,
  title,
  body,
}: {
  selected: boolean;
  onSelect: () => void;
  title: string;
  body?: string;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`rounded-xl border p-4 text-left transition-colors ${
        selected
          ? "border-accent bg-accent/5 ring-1 ring-accent"
          : "border-hairline hover:border-accent/40"
      }`}
    >
      <span className="block font-medium text-navy">{title}</span>
      {body && <span className="mt-1 block text-sm leading-relaxed text-muted">{body}</span>}
    </button>
  );
}

function Field({
  name,
  label,
  type = "text",
  error,
  required,
  className = "",
}: {
  name: string;
  label: string;
  type?: string;
  error?: string;
  required?: boolean;
  className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="text-sm font-medium text-body">
        {label}
        {required && <span className="text-accent"> *</span>}
      </span>
      <input
        name={name}
        type={type}
        required={required}
        className="mt-2 w-full rounded-xl border border-hairline bg-white px-4 py-3 text-body"
      />
      {error && <span className="mt-1 block text-sm text-red-700">{error}</span>}
    </label>
  );
}
