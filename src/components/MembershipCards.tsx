"use client";

import { useState } from "react";
import { ButtonLink, Card } from "./ui";
import { formatCents } from "@/lib/money";
import {
  DEFAULT_MEMBERSHIP_FREQUENCY,
  MEMBERSHIP_FREQUENCIES,
  MEMBERSHIP_TIERS,
  MOST_POPULAR_SIZE,
  UNIT_SIZES,
  type MembershipFrequency,
} from "@/lib/pricing";

/**
 * The membership rates, one card per apartment size, switched between tiers.
 *
 * A toggle rather than six cards. Six is a wall, and the choice a customer is
 * actually making is how often we come, not which of six boxes they are in.
 */
export function MembershipCards({ className = "" }: { className?: string }) {
  const [frequency, setFrequency] = useState<MembershipFrequency>(
    DEFAULT_MEMBERSHIP_FREQUENCY,
  );
  const tier = MEMBERSHIP_TIERS[frequency];

  return (
    <div className={className}>
      <div
        role="group"
        aria-label="How often would you like us?"
        className="mx-auto flex w-fit rounded-full border border-hairline bg-panel p-1"
      >
        {MEMBERSHIP_FREQUENCIES.map((id) => {
          const active = id === frequency;
          return (
            <button
              key={id}
              type="button"
              onClick={() => setFrequency(id)}
              aria-pressed={active}
              className={`rounded-full px-5 py-2 text-sm font-medium transition-colors ${
                active ? "bg-accent text-white" : "text-muted hover:text-navy"
              }`}
            >
              {MEMBERSHIP_TIERS[id].label}
            </button>
          );
        })}
      </div>

      <div className="mt-8 grid gap-6 md:grid-cols-3">
        {UNIT_SIZES.map((size) => {
          const price = tier.prices[size.id];
          const popular = size.id === MOST_POPULAR_SIZE;

          return (
            <Card key={size.id} highlighted={popular} className="flex flex-col">
              {popular && (
                <span className="mb-4 self-start rounded-full bg-accent px-3 py-1 text-[11px] font-semibold uppercase tracking-widest text-white">
                  Most popular
                </span>
              )}
              <h3 className="text-lg font-semibold text-navy">{size.label}</h3>
              <p className="mt-3 text-4xl font-semibold text-accent">
                {formatCents(price.monthlyCents)}
                <span className="text-base font-medium text-muted">/month</span>
              </p>
              <p className="mt-3 text-sm text-body">
                {tier.visitsPerPeriod === 1
                  ? "One cleaning a month"
                  : `${tier.visitsPerPeriod} cleanings · ${formatCents(price.perVisitCents)} each`}
              </p>
              {/* The saving is the headline on the discounted tier and a
                  footnote on the other, because on the once-a-month tier it is
                  a few dollars and pretending otherwise would be noticed the
                  moment somebody does the arithmetic. */}
              <p
                className={
                  tier.firstMonthDiscount > 0
                    ? "mt-1 text-sm font-medium text-accent"
                    : "mt-1 text-sm text-muted"
                }
              >
                {tier.firstMonthDiscount > 0
                  ? `Save ${formatCents(price.savesCents)} a month`
                  : `${formatCents(price.savesCents)} under the one-time rate`}
              </p>
              {/* mt-auto keeps the buttons on a line across all three cards, even
                  though the popular one carries an extra badge. */}
              <div className="mt-auto pt-7">
                <ButtonLink
                  href={`/book?plan=membership&size=${size.id}&freq=${frequency}`}
                  variant={popular ? "primary" : "secondary"}
                  className="w-full"
                >
                  Become a member
                </ButtonLink>
              </div>
            </Card>
          );
        })}
      </div>

      <p className="mt-6 text-center text-sm text-muted">
        {tier.firstMonthDiscount > 0
          ? "Two cleanings every billing period, a free add-on each month, and 15% off your first month."
          : "One cleaning every billing period, on the same day, billed automatically. The free monthly add-on and the discounted first month come with the twice-a-month membership."}
      </p>
    </div>
  );
}
