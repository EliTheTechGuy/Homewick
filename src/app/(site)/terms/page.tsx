import type { Metadata } from "next";
import { Section } from "@/components/ui";
import { formatCents } from "@/lib/money";
import { MEMBERSHIP_TIERS, PET_SURCHARGE_CENTS } from "@/lib/pricing";
import {
  CANCELLATION_NOTICE_HOURS,
  LATE_CANCELLATION_FEE_CENTS,
} from "@/lib/cancellation";
import { TERMS_VERSION, site } from "@/lib/site";

export const metadata: Metadata = {
  title: "Service agreement",
  description:
    "The terms that govern Homewick Cleaning service, including membership rules, cancellation, access, and liability.",
};

export default function TermsPage() {
  return (
    <Section>
      <div className="max-w-3xl">
        <h1 className="text-3xl font-semibold text-navy md:text-4xl">Service agreement</h1>
        <p className="mt-4 text-sm text-muted">
          Version {TERMS_VERSION} · {site.name}, operated by {site.legalEntity} · Service
          area: {site.serviceArea}
        </p>

        <div className="mt-12 space-y-10">
          <Clause n="1" title="Scope of service">
            <p>
              Homewick provides residential cleaning for apartments in the{" "}
              {site.serviceArea}. Cleaning is performed by our staff. Assignments, billing,
              scheduling, and customer communication are handled by the company. Please
              direct any request or complaint to Homewick rather than to the cleaner on
              site. Cleaners are not authorized to negotiate scope, price, or scheduling.
            </p>
            <p>
              Single-family homes fall outside the published apartment rates and are quoted
              separately.
            </p>
          </Clause>

          <Clause n="2" title="Membership">
            <ul>
              <li>
                A membership includes the cleanings its tier states per billing period,
                {" "}
                {MEMBERSHIP_TIERS.twice_monthly.visitsPerPeriod} on the twice-a-month
                membership and {MEMBERSHIP_TIERS.monthly.visitsPerPeriod} on the
                once-a-month membership. Your billing period is anchored to your signup
                date, not the calendar month.
              </li>
              <li>
                Unused cleanings do not roll over. They expire at the end of the billing
                period in which they were issued. A visit you skip consumes its allotment
                in the same way a completed visit does.
              </li>
              <li>
                Visits may be rescheduled within their own billing period. A visit cannot
                be moved into a later period.
              </li>
              <li>
                Twice-a-month members may claim one free add-on per billing period from
                the eligible list. It must be selected when booking the visit so that it
                forms part of the cleaner&apos;s assignment; it cannot be requested at
                the door. The entitlement resets each period and does not accumulate. The
                once-a-month membership does not include a free add-on.
              </li>
              <li>
                A new twice-a-month member&apos;s first billing period is charged at 15%
                off and includes the same number of cleanings as any other period.
                Subsequent periods are charged at the standard rate. The once-a-month
                membership is charged at its standard rate from the first period.
              </li>
              <li>
                Members receive 10% off additional add-ons, priority scheduling, and the
                same cleaner whenever scheduling permits. Continuity of cleaner is an
                intention, not a guarantee.
              </li>
            </ul>
          </Clause>

          <Clause n="3" title="Pricing and payment">
            <ul>
              <li>
                Rates are published on this site and charged as published. Cleaners do not
                quote or collect payment on site.
              </li>
              <li>
                Payment is processed by Stripe. Card details are entered directly with
                Stripe and are never received or stored on Homewick&apos;s systems.
              </li>
              <li>
                A one-time {formatCents(PET_SURCHARGE_CENTS)} surcharge applies when there
                are pets in the home. It is charged once, on your first booking, and is
                not repeated on later visits.
              </li>
              <li>
                Rates are reviewed annually. Any change takes effect only after at least 30
                days&apos; written notice, and applies from the first billing period
                beginning on or after the effective date. Your rate is fixed to your
                subscription at signup; a change to published pricing does not by itself
                change what an existing member pays.
              </li>
            </ul>
          </Clause>

          <Clause n="4" title="Cancellation">
            <p>
              Membership may be cancelled with 14 days&apos; notice. If notice is given
              with 14 or more days remaining in the current billing period, service ends at
              the end of that period. If notice is given with less than 14 days remaining,
              service continues through the end of the following period. Cleanings continue
              to be scheduled and delivered up to the end date, and the membership is not
              refunded on a partial-period basis.
            </p>
            <p>
              A one-time cleaning may be cancelled from your account at any time before
              it takes place. Cancelled with {CANCELLATION_NOTICE_HOURS} hours&apos;
              notice or more, it is refunded in full. Cancelled with less than{" "}
              {CANCELLATION_NOTICE_HOURS} hours&apos; notice, a{" "}
              {formatCents(LATE_CANCELLATION_FEE_CENTS)} late cancellation fee is
              retained and the balance is refunded. Where the amount paid is less than
              the fee, the fee is limited to the amount paid and no further sum is due.
            </p>
            <p>
              Being unable to gain lawful entry at the scheduled time is treated as a
              cancellation with less than {CANCELLATION_NOTICE_HOURS} hours&apos;
              notice. The cleaner has travelled and the slot cannot be resold.
            </p>
            <p>
              Refunds are issued to the original payment method and are typically
              visible within a few working days, depending on the card issuer.
            </p>
          </Clause>

          <Clause n="5" title="Access to your home">
            <p>
              You are responsible for providing a lawful means of entry, such as a gate
              code, a door code, or a key location. Entry information is stored encrypted and separately
              from your other account details, is disclosed only to the cleaner assigned to
              your visit on the day of service, and every disclosure is logged.
            </p>
            <p>
              If our cleaner cannot gain entry at the scheduled time, we will attempt to
              reach you. If entry cannot be obtained, the visit is treated as skipped and
              consumes its allotment for the period.
            </p>
          </Clause>

          <Clause n="6" title="Condition of the home and items we do not handle">
            <p>
              Cleaners will not move heavy furniture or appliances, handle biohazardous
              material, use ladders beyond a two-step stool, or clean exterior windows above
              ground level. We may decline or re-scope a visit where the condition of the
              home makes the booked service unsafe or materially different from what was
              booked; you will be contacted before any change in price.
            </p>
            <p>
              Please secure cash, jewelry, and irreplaceable items before a visit.
            </p>
          </Clause>

          <Clause n="7" title="Laundry">
            <p>
              Laundry, where booked, is performed at the customer&apos;s own risk. Homewick
              accepts no liability for shrinkage, color transfer, or other damage to
              garments or linens arising from laundering, regardless of care-label
              compliance. Bed linen changing, which is included in every clean, is not
              laundry.
            </p>
          </Clause>

          <Clause n="8" title="If something is wrong">
            <p>
              Tell us within 48 hours of the visit and we will return and re-clean the areas
              concerned at no charge. This is the primary remedy under this agreement. We
              ask for the opportunity to correct the work before any other resolution is
              sought.
            </p>
          </Clause>

          <Clause n="9" title="How we contact you">
            <p>
              We contact you by email about your service: your booking confirmation, a
              reminder the morning before a visit, and anything we need to ask you about
              access. These are notifications rather than a support channel, so replies to
              them are not monitored.
            </p>
            <p>
              We do not currently send text messages. If you ticked the box at booking we
              have recorded your consent, and if we introduce text notifications later they
              will cover scheduling only. Message frequency would vary by how often you are
              cleaned, message and data rates may apply, and you would be able to reply STOP
              at any time to unsubscribe or HELP for assistance. Consent is not a condition
              of purchase, and we do not send marketing messages on this basis.
            </p>
          </Clause>

          <Clause n="10" title="Feedback and reviews">
            <p>
              We ask every customer for feedback after a visit and we give every customer
              the same public review link regardless of what they tell us. Ratings are used
              to put things right, never to decide who is invited to review us.
            </p>
          </Clause>

          <Clause n="11" title="Changes to these terms">
            <p>
              These terms are versioned. The version you accepted at booking, together with
              the time of acceptance, is recorded against your account. Material changes are
              notified in advance and take effect at your next billing period.
            </p>
          </Clause>
        </div>

        <p className="mt-14 rounded-xl bg-panel p-5 text-sm leading-relaxed text-muted">
          This agreement sets out how the service operates. It has not been reviewed by
          counsel and should be before launch.
        </p>
      </div>
    </Section>
  );
}

function Clause({
  n,
  title,
  children,
}: {
  n: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="text-xl font-semibold text-navy">
        <span className="mr-3 text-accent">{n}</span>
        {title}
      </h2>
      <div className="mt-3 space-y-3 leading-relaxed text-body [&_li]:ml-5 [&_li]:list-disc [&_ul]:space-y-2.5">
        {children}
      </div>
    </section>
  );
}
