"use client";

import { useState, useTransition } from "react";
import { markCleanerPaid, setCleanerRate } from "@/actions/cleaners";

type Visit = {
  id: string;
  onDate: string;
  serviceType: string;
  visitTotalCents: number;
  payCents: number | null;
  isLead: boolean;
};

function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/**
 * One cleaner: their rate, what they are owed, and the button that records
 * having paid them.
 *
 * The visit ids being paid are submitted with the form rather than recomputed
 * on the server. A visit completed between this page loading and the button
 * being pressed would otherwise be marked paid without being part of the
 * amount actually transferred.
 */
export function CleanerPayCard({
  cleanerId,
  name,
  email,
  isActive,
  percent,
  visits,
}: {
  cleanerId: string;
  name: string;
  email: string;
  isActive: boolean;
  percent: number | null;
  visits: Visit[];
}) {
  const [note, setNote] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const payable = visits.filter((v) => v.payCents !== null);
  const owed = payable.reduce((sum, v) => sum + (v.payCents ?? 0), 0);
  const unpriced = visits.length - payable.length;

  return (
    <div className="rounded-2xl border border-hairline p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-navy">
            {name}
            {!isActive && (
              <span className="ml-2 rounded-full bg-panel px-2 py-0.5 text-xs font-medium text-muted">
                Off roster
              </span>
            )}
          </h2>
          <p className="text-sm text-muted">{email}</p>
        </div>
        <div className="text-right">
          <p className="text-xs uppercase tracking-widest text-muted">Owed</p>
          <p className="text-2xl font-semibold text-navy">{money(owed)}</p>
        </div>
      </div>

      <form
        action={(formData) =>
          startTransition(async () => setNote((await setCleanerRate(formData)).message))
        }
        className="mt-4 flex flex-wrap items-end gap-2"
      >
        <input type="hidden" name="cleanerId" value={cleanerId} />
        <label className="text-sm">
          <span className="block font-medium text-body">Their share of each visit</span>
          <span className="mt-1 flex items-center gap-1">
            <input
              name="percent"
              type="number"
              min={0}
              max={100}
              step={1}
              defaultValue={percent ?? ""}
              placeholder="not set"
              className="w-28 rounded-xl border border-hairline bg-white px-3 py-2 text-body"
            />
            <span className="text-muted">%</span>
          </span>
        </label>
        <button
          type="submit"
          disabled={pending}
          className="rounded-full border border-hairline px-4 py-2 text-sm font-semibold text-navy disabled:opacity-60"
        >
          Save rate
        </button>
        <p className="w-full text-xs text-muted">
          Applies to work assigned from now on. Visits already assigned keep the
          figure agreed at the time.
        </p>
      </form>

      {visits.length === 0 ? (
        <p className="mt-5 border-t border-hairline pt-4 text-sm text-muted">
          Nothing outstanding.
        </p>
      ) : (
        <div className="mt-5 border-t border-hairline pt-4">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-widest text-muted">
                <th className="pb-2 font-medium">Date</th>
                <th className="pb-2 font-medium">Service</th>
                <th className="pb-2 text-right font-medium">Visit</th>
                <th className="pb-2 text-right font-medium">Their pay</th>
              </tr>
            </thead>
            <tbody>
              {visits.map((v) => (
                <tr key={v.id} className="border-t border-hairline">
                  <td className="py-2 text-body">{v.onDate}</td>
                  <td className="py-2 text-body">
                    {v.serviceType}
                    {v.isLead && (
                      <span className="ml-2 rounded-full bg-panel px-2 py-0.5 text-xs font-medium text-muted">
                        lead
                      </span>
                    )}
                  </td>
                  <td className="py-2 text-right text-muted">{money(v.visitTotalCents)}</td>
                  <td className="py-2 text-right font-medium text-navy">
                    {v.payCents === null ? (
                      <span className="text-amber-700">no rate set</span>
                    ) : (
                      money(v.payCents)
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {unpriced > 0 && (
            <p className="mt-3 text-xs text-amber-800">
              {unpriced} visit{unpriced === 1 ? " has" : "s have"} no rate and cannot be
              paid. Set a rate, then reassign the visit to price it.
            </p>
          )}

          {payable.length > 0 && (
            <form
              action={(formData) =>
                startTransition(async () =>
                  setNote((await markCleanerPaid(formData)).message),
                )
              }
              className="mt-4 flex flex-wrap items-end gap-2"
            >
              <input type="hidden" name="cleanerId" value={cleanerId} />
              {payable.map((v) => (
                <input key={v.id} type="hidden" name="visitId" value={v.id} />
              ))}
              <label className="text-sm">
                <span className="block font-medium text-body">Reference</span>
                <input
                  name="reference"
                  placeholder="Zelle, cheque number, bank ref"
                  className="mt-1 w-64 rounded-xl border border-hairline bg-white px-3 py-2 text-body"
                />
              </label>
              <button
                type="submit"
                disabled={pending}
                className="rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-accent-dark disabled:opacity-60"
              >
                {pending ? "Recording…" : `Mark ${money(owed)} paid`}
              </button>
            </form>
          )}
        </div>
      )}

      {note && (
        <p role="status" className="mt-3 text-sm text-body">
          {note}
        </p>
      )}
    </div>
  );
}
