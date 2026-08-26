"use client";

import { useState } from "react";
import Link from "next/link";
import { formatLong } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { AssignCrew, type CleanerOption } from "./AssignCrew";
import { SendPaymentLink } from "./SendPaymentLink";
import { SendConfirmation } from "./SendConfirmation";
import { CancelVisitAdmin } from "./CancelVisitAdmin";
import { MarkComplete } from "@/components/MarkComplete";
import { MarkSkipped } from "@/components/MarkSkipped";
import { RevealAccess } from "@/components/RevealAccess";

export type BookingRowData = {
  id: string;
  onDate: string;
  atTime: string;
  status: string;
  origin: string;
  serviceLabel: string;
  propertyLabel: string;
  isHouse: boolean;
  hasPets: boolean;
  line1: string;
  line2: string | null;
  city: string;
  postalCode: string;
  customerName: string;
  phone: string;
  email: string;
  instructions: string | null;
  priceCents: number;
  subscriptionId: string | null;
  propertyId: string;
  awaitingPayment: boolean;
  hasEntryDetails: boolean;
  crew: { cleanerId: string; name: string; isLead: boolean; payCents: number | null }[];
};

/**
 * One booking in the list, closed until you want it.
 *
 * Opening it in place rather than navigating away is the point: working a list
 * of jobs means opening one, doing a thing, and moving to the next, and a page
 * load between each of those loses your place in the list every time.
 *
 * Everything that acts on a booking lives in here rather than on the schedule
 * card. The schedule answers what is happening today and wants to be readable
 * at a glance; five buttons under every card was the cost of it being the only
 * way to reach a job at all.
 */
export function BookingRow({
  booking,
  cleaners,
  defaultOpen = false,
}: {
  booking: BookingRowData;
  cleaners: CleanerOption[];
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  const address = [booking.line1, booking.line2].filter(Boolean).join(", ");
  const workable = booking.status !== "completed" && booking.status !== "skipped";
  const cancelled = booking.status === "canceled";
  const needsCleaner = booking.crew.length === 0 && workable && !cancelled;

  return (
    <li className="overflow-hidden rounded-2xl border border-hairline bg-white">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full flex-wrap items-center justify-between gap-x-6 gap-y-2 p-5 text-left transition-colors hover:bg-panel/60"
      >
        <span className="min-w-0">
          <span className="block text-sm font-semibold tracking-wide text-accent">
            {formatLong(booking.onDate)} &middot; {booking.atTime}
          </span>
          <span className="mt-0.5 block truncate text-lg font-semibold text-navy">
            {address}
          </span>
          <span className="block truncate text-sm text-muted">
            {booking.customerName} &middot; {booking.city} {booking.postalCode}
          </span>
        </span>

        <span className="flex flex-wrap items-center gap-2">
          {cancelled && <Tag tone="bad">Cancelled</Tag>}
          {booking.awaitingPayment && <Tag tone="warn">Unpaid</Tag>}
          {needsCleaner && <Tag tone="warn">Needs a cleaner</Tag>}
          {booking.crew.length > 0 && (
            <Tag>
              {booking.crew.length === 1
                ? booking.crew[0].name
                : `${booking.crew.length} cleaners`}
            </Tag>
          )}
          <Tag>{booking.serviceLabel}</Tag>
          <span aria-hidden className="text-muted">
            {open ? "−" : "+"}
          </span>
        </span>
      </button>

      {open && (
        <div className="border-t border-hairline px-5 pb-5">
          <dl className="grid gap-x-8 gap-y-2 py-4 sm:grid-cols-2">
            <Detail label="Property" value={booking.propertyLabel} />
            <Detail
              label="Booking"
              value={booking.origin === "membership" ? "Membership" : "One-time"}
            />
            <Detail label="Phone" value={booking.phone} href={`tel:${booking.phone}`} />
            <Detail label="Email" value={booking.email} href={`mailto:${booking.email}`} />
            <Detail label="Worth" value={formatCents(booking.priceCents)} />
            {booking.hasPets && <Detail label="Pets" value="Yes, at this address" />}
          </dl>

          {booking.instructions && (
            <div className="rounded-xl bg-panel p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted">
                Customer instructions
              </p>
              <p className="mt-1 whitespace-pre-line leading-relaxed text-body">
                {booking.instructions}
              </p>
            </div>
          )}

          {!cancelled && (
            <div className="mt-5 border-t border-hairline pt-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted">
                Crew
              </p>
              <div className="mt-3">
                <AssignCrew
                  visitId={booking.id}
                  cleaners={cleaners}
                  crew={booking.crew.map((c) => ({
                    cleanerId: c.cleanerId,
                    isLead: c.isLead,
                  }))}
                  isHouse={booking.isHouse}
                />
              </div>
              {booking.crew.length > 0 && (
                <ul className="mt-3 space-y-1">
                  {booking.crew.map((c) => (
                    <li
                      key={c.cleanerId}
                      className="flex flex-wrap justify-between gap-3 text-sm"
                    >
                      <span className="text-muted">
                        {c.name}
                        {c.isLead && booking.crew.length > 1 && " (lead)"}
                      </span>
                      <span className={c.payCents == null ? "text-amber-800" : "text-body"}>
                        {c.payCents == null ? "No rate set" : `${formatCents(c.payCents)} owed`}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-hairline pt-4">
            {!cancelled && <SendConfirmation visitId={booking.id} />}
            {booking.awaitingPayment && (
              <SendPaymentLink
                kind={booking.subscriptionId ? "membership" : "one_time"}
                id={booking.subscriptionId ?? booking.id}
              />
            )}
            {!cancelled && booking.hasEntryDetails && (
              <RevealAccess visitId={booking.id} propertyId={booking.propertyId} />
            )}
            {!cancelled && workable && (
              <>
                <MarkComplete visitId={booking.id} />
                <MarkSkipped visitId={booking.id} />
              </>
            )}
            {!cancelled && workable && booking.origin === "one_off" && (
              <CancelVisitAdmin visitId={booking.id} />
            )}
            <Link
              href={`/admin/visit/${booking.id}`}
              className="text-sm font-medium text-accent hover:underline"
            >
              Open on its own
            </Link>
          </div>
        </div>
      )}
    </li>
  );
}

function Detail({
  label,
  value,
  href,
}: {
  label: string;
  value: string;
  href?: string;
}) {
  return (
    <div className="flex justify-between gap-4 border-b border-hairline py-1.5 last:border-0">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="text-right text-sm font-medium text-body">
        {href ? (
          <a href={href} className="text-accent underline">
            {value}
          </a>
        ) : (
          value
        )}
      </dd>
    </div>
  );
}

function Tag({
  children,
  tone = "plain",
}: {
  children: React.ReactNode;
  tone?: "plain" | "warn" | "bad";
}) {
  const tones = {
    plain: "border-hairline text-muted",
    warn: "border-amber-300 bg-amber-50 text-amber-900",
    bad: "border-red-200 bg-red-50 text-red-800",
  };
  return (
    <span className={`rounded-full border px-3 py-1 text-xs font-medium ${tones[tone]}`}>
      {children}
    </span>
  );
}
