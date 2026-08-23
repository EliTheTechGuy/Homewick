"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { changeMembershipSize, updateAddress } from "@/actions/profile";
import { cadenceLabel } from "@/lib/cadence";
import { formatLong } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import {
  UNIT_SIZES,
  frequencyForVisits,
  membershipPrice,
  membershipTier,
  unitSizeLabel,
  type UnitSize,
} from "@/lib/pricing";
import type { MemberOverview } from "@/lib/member-account";
import { Card } from "@/components/ui";

const inputClass =
  "mt-1.5 w-full rounded-xl border border-hairline bg-white px-4 py-2.5 text-body";

/**
 * Where we clean, and what size it is.
 *
 * Both live here because they are the same event in a member's life. Somebody
 * who moves usually moves into a different size, and making them find two
 * unrelated screens to describe one move is how you end up cleaning the right
 * apartment at the wrong price.
 */
export function ProfileSection({ overview }: { overview: MemberOverview }) {
  const { property, subscription, pendingRate } = overview;
  const [editing, setEditing] = useState(false);
  const movedRef = useRef<HTMLButtonElement>(null);
  const opened = useRef(false);

  // Closing the form returns focus to the trigger that opened it, which has
  // just remounted. The form takes care of focusing itself on the way in.
  // The flag stops this firing on first render, where nothing was opened and
  // stealing focus would be its own bug.
  useEffect(() => {
    if (editing) opened.current = true;
    else if (opened.current) movedRef.current?.focus();
  }, [editing]);

  if (!property || !subscription) return null;

  return (
    <Card className="mt-6">
      <h2 className="text-lg font-semibold text-navy">Your details</h2>

      {editing ? (
        <AddressForm
          property={property}
          onDone={() => setEditing(false)}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <div className="mt-4">
          <p className="text-sm font-medium text-muted">Where we clean</p>
          <p className="mt-1 text-body">
            {property.line1}
            {property.line2 ? `, ${property.line2}` : ""}
            <br />
            {property.city}, {property.state} {property.postalCode}
          </p>
          <button
            ref={movedRef}
            type="button"
            onClick={() => setEditing(true)}
            className="mt-2 text-sm font-medium text-accent hover:underline"
          >
            I have moved
          </button>
        </div>
      )}

      <div className="mt-6 border-t border-hairline pt-6">
        {subscription.intervalDays == null ? (
          <SizeChooser
            current={subscription.unitSize}
            currentRateCents={subscription.monthlyAmountCents}
            visitsPerPeriod={subscription.visitsPerPeriod}
            pendingRate={pendingRate}
          />
        ) : (
          /* Replaced rather than adapted. There is no published price list for
             a schedule agreed by hand, so showing the apartment sizes would
             offer this customer rates that have nothing to do with their
             arrangement, and let them set one by accident. */
          <div>
            <p className="text-sm font-medium text-muted">Your schedule</p>
            <p className="mt-1 text-body">
              {formatCents(subscription.monthlyAmountCents)}{" "}
              {cadenceLabel(subscription.intervalDays)}
            </p>
            <p className="mt-4 text-sm leading-relaxed text-muted">
              This was arranged with us directly rather than from the published
              rates, so it is not something to change from here. Get in touch and we
              will sort it.
            </p>
          </div>
        )}
      </div>
    </Card>
  );
}

function AddressForm({
  property,
  onDone,
  onCancel,
}: {
  property: NonNullable<MemberOverview["property"]>;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [entryMethod, setEntryMethod] = useState("lobby");
  const formRef = useRef<HTMLFormElement>(null);

  // The trigger that opened this has unmounted, so without moving focus a
  // keyboard user is left at the top of the page with no idea a form appeared.
  useEffect(() => {
    formRef.current?.focus();
  }, []);

  function submit(form: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await updateAddress(form);
      if (result.ok) onDone();
      else setError(result.message);
    });
  }

  return (
    <form
      ref={formRef}
      action={submit}
      tabIndex={-1}
      aria-label="Change your address"
      className="mt-4 space-y-4 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
    >
      <p className="text-sm leading-relaxed text-muted">
        Tell us the new place and we will move your upcoming cleanings across.
        Nothing about your membership changes.
      </p>

      <label className="block text-sm">
        <span className="font-medium text-body">Street address</span>
        <input name="line1" required defaultValue="" className={inputClass} />
      </label>

      <label className="block text-sm">
        <span className="font-medium text-body">Apartment or unit</span>
        <input name="line2" className={inputClass} />
      </label>

      <div className="grid gap-4 sm:grid-cols-3">
        <label className="block text-sm sm:col-span-2">
          <span className="font-medium text-body">City</span>
          <input name="city" required className={inputClass} />
        </label>
        <label className="block text-sm">
          <span className="font-medium text-body">ZIP</span>
          <input name="postalCode" required inputMode="numeric" className={inputClass} />
        </label>
      </div>

      <label className="block text-sm">
        <span className="font-medium text-body">How do we get in?</span>
        <select
          name="entryMethod"
          value={entryMethod}
          onChange={(e) => setEntryMethod(e.target.value)}
          className={inputClass}
        >
          <option value="lobby">Someone lets us in at the lobby</option>
          <option value="gate_code">Gate code</option>
          <option value="door_code">Door code</option>
          <option value="key_location">Key is left somewhere</option>
        </select>
      </label>

      {entryMethod !== "lobby" && (
        <label className="block text-sm">
          <span className="font-medium text-body">
            {entryMethod === "key_location" ? "Where is the key?" : "The code"}
          </span>
          <input name="entryDetail" className={inputClass} />
          <span className="mt-1 block text-xs text-muted">
            Stored encrypted and shown to your cleaner on the day only. Your old
            entry details are not carried over.
          </span>
        </label>
      )}

      <label className="block text-sm">
        <span className="font-medium text-body">Parking notes</span>
        <input name="parkingNotes" className={inputClass} />
      </label>

      <label className="flex items-center gap-2 text-sm text-body">
        <input type="checkbox" name="hasPets" defaultChecked={property.hasPets} />
        There are pets at this address
      </label>

      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-full bg-accent px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent-dark disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save new address"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          className="rounded-full border border-hairline px-5 py-2 text-sm font-semibold text-body"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function SizeChooser({
  current,
  currentRateCents,
  visitsPerPeriod,
  pendingRate,
}: {
  current: UnitSize;
  currentRateCents: number;
  visitsPerPeriod: number;
  pendingRate: MemberOverview["pendingRate"];
}) {
  // Their own tier's rates, not the headline ones. A once-a-month member
  // reading the twice-a-month prices here would pick a size expecting one
  // number and be charged another.
  const frequency = frequencyForVisits(visitsPerPeriod) ?? "twice_monthly";
  const [choice, setChoice] = useState<UnitSize>(current);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  function save() {
    setMessage(null);
    startTransition(async () => {
      const result = await changeMembershipSize(choice);
      setFailed(!result.ok);
      setMessage(result.message);
    });
  }

  return (
    <div>
      <p className="text-sm font-medium text-muted">Your membership</p>
      <p className="mt-1 text-body">
        {unitSizeLabel(current)}, {formatCents(currentRateCents)} a month
      </p>
      <p className="mt-1 text-sm text-muted">
        {membershipTier(frequency).label}
      </p>

      {pendingRate && (
        <p className="mt-2 rounded-xl bg-white px-4 py-3 text-sm text-body">
          Changing to {formatCents(pendingRate.amountCents)} a month from{" "}
          {formatLong(pendingRate.effectiveOn)}.
        </p>
      )}

      <p className="mt-4 text-sm leading-relaxed text-muted">
        Moved to a different size? Change it here. The new rate starts at your
        next billing date, so this month stays as it is.
      </p>

      <div className="mt-3 space-y-2">
        {UNIT_SIZES.map((size) => (
          <label
            key={size.id}
            className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-hairline bg-white px-4 py-3 text-sm"
          >
            <span className="flex items-center gap-3">
              <input
                type="radio"
                name="unitSize"
                value={size.id}
                checked={choice === size.id}
                onChange={() => setChoice(size.id)}
              />
              <span className="font-medium text-body">{size.label}</span>
            </span>
            <span className="text-muted">
              {formatCents(membershipPrice(frequency, size.id).monthlyCents)} a month
            </span>
          </label>
        ))}
      </div>

      {message && (
        <p
          role={failed ? "alert" : "status"}
          className={`mt-3 text-sm ${failed ? "text-red-700" : "text-body"}`}
        >
          {message}
        </p>
      )}

      <button
        type="button"
        onClick={save}
        disabled={pending || choice === current}
        className="mt-3 rounded-full bg-accent px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent-dark disabled:opacity-50"
      >
        {pending ? "Saving…" : "Change my membership"}
      </button>
    </div>
  );
}
