import type { Metadata } from "next";
import { ButtonLink, Card, CheckIcon, Section, SectionHeading } from "@/components/ui";
import { MembershipCards } from "@/components/MembershipCards";
import { formatCents } from "@/lib/money";
import {
  FREE_PERK_ELIGIBLE,
  MEMBER_BENEFITS,
  PET_SURCHARGE_CENTS,
  VISITS_PER_PERIOD,
} from "@/lib/pricing";

export const metadata: Metadata = {
  title: "Membership",
  description:
    "Two apartment cleanings every month for one charge, with a free add-on each month and the same cleaner whenever scheduling allows.",
};

const rules = [
  {
    q: `How many cleanings do I get?`,
    a: `${VISITS_PER_PERIOD} per billing period. Your billing period is anchored to the date you sign up, not to the calendar month.`,
  },
  {
    q: "Do unused cleanings roll over?",
    a: "No. Unused visits expire at the end of the billing period, and a skipped visit uses its allotment the same way a completed one does. You can reschedule freely inside your period.",
  },
  {
    q: "Can I move a visit into next month?",
    a: "No — rescheduling stays within the billing period it belongs to. Moving a visit across periods would be rollover by another name.",
  },
  {
    q: "How does the free add-on work?",
    a: "One eligible add-on per billing period, claimed when you book the visit so it reaches your cleaner as part of the assignment. It resets each period and never accumulates.",
  },
  {
    q: "What happens when I join?",
    a: "Your first cleaning is a deep clean, and it is one of the two cleanings your first month already covers — not an extra charge. Your first month is also 15% off; every month after is the standard rate.",
  },
  {
    q: "How do I cancel?",
    a: "Fourteen days' notice. If you give notice with 14 or more days left in your current period, service ends at the end of that period. Otherwise it runs through the following period. Visits keep being scheduled until the end date.",
  },
  {
    q: "Will my rate change?",
    a: "Rates are reviewed once a year with 30 days' written notice before any change takes effect. Your rate is fixed to your subscription when you sign up — raising the published price does not reprice existing members.",
  },
  {
    q: "I have pets.",
    a: `A one-time ${formatCents(PET_SURCHARGE_CENTS)} surcharge applies when there are pets in the home. It is charged once, on your first booking — not on every clean.`,
  },
];

export default function MembershipPage() {
  return (
    <>
      <Section>
        <SectionHeading
          eyebrow="Membership"
          title="Two cleanings every month, one simple charge."
          lead="Membership is the cheapest way to use Homewick and the reason the service stays consistent — the same apartment, the same standard, on a rhythm."
        />
        <MembershipCards className="mt-12" />
      </Section>

      <Section tinted>
        <div className="grid gap-12 md:grid-cols-2">
          <div>
            <SectionHeading eyebrow="Included" title="What members get." />
            <ul className="mt-8 space-y-4">
              {MEMBER_BENEFITS.map((b) => (
                <li key={b} className="flex gap-3 leading-relaxed text-body">
                  <CheckIcon className="mt-1 h-5 w-5 shrink-0 text-accent" />
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          </div>
          <Card>
            <h3 className="text-lg font-semibold text-navy">
              Add-ons eligible as your free monthly perk
            </h3>
            <ul className="mt-4 space-y-3">
              {FREE_PERK_ELIGIBLE.map((a) => (
                <li
                  key={a.code}
                  className="flex items-baseline justify-between gap-4 border-b border-hairline pb-3 text-body"
                >
                  <span>{a.name}</span>
                  <span className="text-sm text-muted line-through">
                    {formatCents(a.priceCents)}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-5 text-sm leading-relaxed text-muted">
              Cabinet interiors and laundry are not eligible as the free perk, but members
              still get 10% off them.
            </p>
          </Card>
        </div>
      </Section>

      <Section>
        <SectionHeading eyebrow="The rules" title="How membership actually works." />
        <dl className="mt-10 grid gap-x-12 gap-y-8 md:grid-cols-2">
          {rules.map((r) => (
            <div key={r.q}>
              <dt className="font-semibold text-navy">{r.q}</dt>
              <dd className="mt-2 leading-relaxed text-muted">{r.a}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-12 flex flex-wrap gap-3">
          <ButtonLink href="/book?plan=membership">Become a member</ButtonLink>
          <ButtonLink href="/terms" variant="secondary">
            Read the full service agreement
          </ButtonLink>
        </div>
      </Section>
    </>
  );
}
