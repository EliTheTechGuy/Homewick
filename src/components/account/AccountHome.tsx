"use client";

import { useState, useTransition } from "react";
import {
  cancelMembership,
  chooseFreeAddOn,
  openBillingPortal,
  signOut,
} from "@/actions/account";
import { formatLong } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { FREE_PERK_ELIGIBLE, unitSizeLabel } from "@/lib/pricing";
import type { MemberOverview } from "@/lib/member-account";
import type { Member } from "@/lib/member-auth";
import { Card } from "@/components/ui";
import { RescheduleVisit } from "./RescheduleVisit";
import { ProfileSection } from "./ProfileSection";

export function AccountHome({
  member,
  overview,
}: {
  member: Member;
  overview: MemberOverview;
}) {
  const [pending, startTransition] = useTransition();
  const [notice, setNotice] = useState<{ ok: boolean; message: string } | null>(null);
  const [choice, setChoice] = useState("");
  const [confirmingCancel, setConfirmingCancel] = useState(false);

  const { subscription, currentPeriod, upcoming } = overview;
  const perkAvailable =
    Boolean(currentPeriod) && !currentPeriod!.freeAddOnUsed && Boolean(overview.claimableVisitId);

  function claim() {
    if (!choice) return;
    setNotice(null);
    startTransition(async () => setNotice(await chooseFreeAddOn(choice)));
  }

  function cancel() {
    setNotice(null);
    startTransition(async () => {
      const result = await cancelMembership();
      setNotice(result);
      if (result.ok) setConfirmingCancel(false);
    });
  }

  function billing() {
    setNotice(null);
    startTransition(async () => {
      const result = await openBillingPortal();
      if ("url" in result) window.location.href = result.url;
      else setNotice({ ok: false, message: result.error });
    });
  }

  return (
    <div className="max-w-3xl">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold text-navy md:text-4xl">
            Hi {member.firstName}
          </h1>
          <p className="mt-2 text-muted">{member.email}</p>
        </div>
        <form action={signOut}>
          <button type="submit" className="text-sm font-medium text-accent hover:underline">
            Sign out
          </button>
        </form>
      </div>

      {notice && (
        <p
          className={`mt-6 rounded-xl p-4 text-sm ${
            notice.ok
              ? "border border-emerald-200 bg-emerald-50 text-emerald-900"
              : "border border-red-200 bg-red-50 text-red-800"
          }`}
        >
          {notice.message}
        </p>
      )}

      {/* Membership */}
      <Card className="mt-8">
        <h2 className="text-lg font-semibold text-navy">Your membership</h2>
        {subscription ? (
          <>
            <p className="mt-2 text-body">
              {unitSizeLabel(subscription.unitSize)} ·{" "}
              {formatCents(subscription.monthlyAmountCents)} a month
            </p>
            {currentPeriod && (
              <p className="mt-1 text-sm text-muted">
                This month: {currentPeriod.visitsUsed} of {currentPeriod.visitsAllotted}{" "}
                cleanings scheduled, through {formatLong(currentPeriod.endsOn)}.
              </p>
            )}
            {subscription.status === "pending_cancellation" && subscription.endsOn && (
              <p className="mt-3 rounded-lg bg-panel p-3 text-sm text-body">
                Your membership ends on {formatLong(subscription.endsOn)}. Cleanings
                already scheduled before then still go ahead.
              </p>
            )}
          </>
        ) : (
          <p className="mt-2 text-muted">
            You do not have an active membership. Any one-off cleanings you have booked
            are listed below.
          </p>
        )}
      </Card>

      {/* Free add-on */}
      {subscription && (
        <Card className="mt-6">
          <h2 className="text-lg font-semibold text-navy">This month&apos;s free add-on</h2>

          {overview.claimedAddOnName ? (
            <p className="mt-2 text-body">
              You chose <strong>{overview.claimedAddOnName}</strong> this month. It is
              booked for your next clean at no charge.
            </p>
          ) : perkAvailable ? (
            <>
              <p className="mt-2 text-sm leading-relaxed text-muted">
                Pick one, free, on your next cleaning. It resets at the start of each
                month and does not carry over.
              </p>
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                {FREE_PERK_ELIGIBLE.map((a) => (
                  <label
                    key={a.code}
                    className={`flex cursor-pointer items-center justify-between gap-3 rounded-xl border p-4 transition-colors ${
                      choice === a.code
                        ? "border-accent bg-accent/5"
                        : "border-hairline hover:border-accent/40"
                    }`}
                  >
                    <span className="flex items-center gap-3">
                      <input
                        type="radio"
                        name="perk"
                        checked={choice === a.code}
                        onChange={() => setChoice(a.code)}
                        className="h-4 w-4 accent-[#1F5FA6]"
                      />
                      <span className="text-sm text-body">{a.name}</span>
                    </span>
                    <span className="text-sm text-muted line-through">
                      {formatCents(a.priceCents)}
                    </span>
                  </label>
                ))}
              </div>
              <button
                type="button"
                onClick={claim}
                disabled={pending || !choice}
                className="mt-5 rounded-full bg-accent px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-accent-dark disabled:opacity-50"
              >
                {pending ? "Adding…" : "Add it to my next clean"}
              </button>
            </>
          ) : (
            <p className="mt-2 text-sm leading-relaxed text-muted">
              {currentPeriod?.freeAddOnUsed
                ? "You have already used this month's free add-on."
                : "There is no upcoming cleaning left this month to attach it to. It will be available again next month."}
            </p>
          )}
        </Card>
      )}

      {/* Upcoming */}
      <Card className="mt-6">
        <h2 className="text-lg font-semibold text-navy">Upcoming cleanings</h2>
        {upcoming.length === 0 ? (
          <p className="mt-2 text-muted">Nothing scheduled yet.</p>
        ) : (
          <ul className="mt-4 divide-y divide-hairline">
            {upcoming.map((v) => (
              <li key={v.id} className="flex flex-wrap items-baseline justify-between gap-x-4 py-3">
                <span className="text-body">{formatLong(v.onDate)}</span>
                <RescheduleVisit visit={v} />
              </li>
            ))}
          </ul>
        )}
        <p className="mt-4 text-sm leading-relaxed text-muted">
          Move a cleaning to whatever day suits you. Whatever you pick becomes your
          usual day from then on.
        </p>
      </Card>

      {/* Address and membership size */}
      <ProfileSection overview={overview} />

      {/* Billing */}
      <Card className="mt-6">
        <h2 className="text-lg font-semibold text-navy">Card and invoices</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Your card is held by Stripe, not by us. Update it or download invoices there.
        </p>
        <button
          type="button"
          onClick={billing}
          disabled={pending}
          className="mt-4 rounded-full border border-accent px-6 py-3 text-sm font-semibold text-accent transition-colors hover:bg-accent hover:text-white disabled:opacity-50"
        >
          {pending ? "Opening…" : "Manage card and invoices"}
        </button>
      </Card>

      {/* Cancelling */}
      {subscription && subscription.status !== "pending_cancellation" && (
        <Card className="mt-6">
          <h2 className="text-lg font-semibold text-navy">Cancel membership</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            Membership needs 14 days&apos; notice. Based on where you are in your
            billing period, cancelling now would end your membership on{" "}
            <strong className="text-navy">{formatLong(subscription.wouldEndOn)}</strong>.
            Cleanings booked before then still go ahead, and you will not be charged
            again.
          </p>

          {confirmingCancel ? (
            <div className="mt-4 rounded-xl border border-hairline bg-panel p-4">
              <p className="text-sm font-medium text-navy">
                Cancel your membership on {formatLong(subscription.wouldEndOn)}?
              </p>
              <div className="mt-3 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={cancel}
                  disabled={pending}
                  className="rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-accent-dark disabled:opacity-50"
                >
                  {pending ? "Cancelling…" : "Yes, cancel it"}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingCancel(false)}
                  disabled={pending}
                  className="rounded-full border border-hairline px-5 py-2.5 text-sm font-semibold text-body"
                >
                  Keep my membership
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmingCancel(true)}
              className="mt-4 text-sm font-medium text-accent hover:underline"
            >
              Cancel my membership
            </button>
          )}
        </Card>
      )}
    </div>
  );
}
