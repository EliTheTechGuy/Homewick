import type { Metadata } from "next";
import Image from "next/image";
import { ButtonLink, Card, CheckIcon, Section, SectionHeading } from "@/components/ui";
import { MembershipCards } from "@/components/MembershipCards";
import { formatCents } from "@/lib/money";
import {
  FREE_PERK_ELIGIBLE,
  MEMBERSHIP_TIERS,
  PET_SURCHARGE_CENTS,
} from "@/lib/pricing";

export const metadata: Metadata = {
  title: "Membership",
  description:
    "Apartment cleaning once or twice a month for one charge, with the same cleaner whenever scheduling allows.",
};

const rules = [
  {
    q: `How many cleanings do I get?`,
    a: "Two per billing period on the twice-a-month membership, one on the once-a-month membership. Your billing period is anchored to the date you sign up, not to the calendar month.",
  },
  {
    q: "Which one should I pick?",
    a: "Twice a month is the cheaper way to buy cleaning, at 15% under the one-time rate for each visit, and it is the one that keeps a place steady. Once a month is for somewhere that only needs a reset now and then, and it is priced close to a one-time clean because it is one.",
  },
  {
    q: "Do unused cleanings roll over?",
    a: "No. Unused visits expire at the end of the billing period, and a skipped visit uses its allotment the same way a completed one does. You can reschedule freely inside your period.",
  },
  {
    q: "Can I move a visit into next month?",
    a: "No. Rescheduling stays within the billing period it belongs to, because moving a visit across periods would be rollover by another name.",
  },
  {
    q: "How does the free add-on work?",
    a: "One eligible add-on per billing period on the twice-a-month membership, claimed when you book the visit so it reaches your cleaner as part of the assignment. It resets each period and never accumulates. The once-a-month membership gets 10% off add-ons rather than one free.",
  },
  {
    q: "What happens when I join?",
    a: "On the twice-a-month membership your first month is 15% off and covers two cleanings like any other month. On the once-a-month membership the first charge is the ordinary rate. Either way there is nothing extra to buy at signup."
  },

  {
    q: "How do I cancel?",
    a: "Fourteen days' notice. If you give notice with 14 or more days left in your current period, service ends at the end of that period. Otherwise it runs through the following period. Visits keep being scheduled until the end date.",
  },
  {
    q: "Will my rate change?",
    a: "Rates are reviewed once a year with 30 days' written notice before any change takes effect. Your rate is fixed to your subscription when you sign up, so raising the published price does not reprice existing members.",
  },
  {
    q: "I have pets.",
    a: `A one-time ${formatCents(PET_SURCHARGE_CENTS)} surcharge applies when there are pets in the home. It is charged once, on your first booking, and never on later cleans.`,
  },
];

export default function MembershipPage() {
  return (
    <>
      <Section>
        <SectionHeading
          as="h1"
          eyebrow="Membership"
          title="Cleaning on a rhythm, one simple charge."
          lead="Twice a month is the cheapest way to use Homewick and the reason the service stays consistent. Once a month is there for a place that needs a reset rather than upkeep. The same apartment, the same standard, either way."
        />
        <MembershipCards className="mt-12" />
      </Section>

      <div className="relative h-52 w-full md:h-64">
        <Image
          src="/photography/sofa.jpg"
          alt=""
          fill
          sizes="100vw"
          className="object-cover"
        />
      </div>

      <Section tinted>
        <div className="grid gap-12 md:grid-cols-2">
          <div>
            <SectionHeading eyebrow="Included" title="What members get." />
            {/* Side by side, because the difference between the two is the
                decision being made on this page and a single merged list with
                asterisks against half of it answers nobody. */}
            <div className="mt-8 space-y-8">
              {(["twice_monthly", "monthly"] as const).map((id) => (
                <div key={id}>
                  <h3 className="text-sm font-semibold uppercase tracking-widest text-muted">
                    {MEMBERSHIP_TIERS[id].label}
                  </h3>
                  <ul className="mt-4 space-y-3">
                    {MEMBERSHIP_TIERS[id].benefits.map((b) => (
                      <li key={b} className="flex gap-3 leading-relaxed text-body">
                        <CheckIcon className="mt-1 h-5 w-5 shrink-0 text-accent" />
                        <span>{b}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
          <Card>
            <h3 className="text-lg font-semibold text-navy">
              Add-ons eligible as the free monthly perk
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
              The free monthly add-on comes with the twice-a-month membership. Cabinet
              interiors and laundry are not eligible as the free perk, but every member
              gets 10% off them.
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
