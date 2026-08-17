import type { Metadata } from "next";
import Link from "next/link";
import { Section } from "@/components/ui";
import { PRIVACY_VERSION, site } from "@/lib/site";

export const metadata: Metadata = {
  title: "Privacy policy",
  description:
    "What Homewick Cleaning collects, why, who it is shared with, and how long it is kept.",
};

/**
 * Written against what the code actually does rather than from a template.
 *
 * Every category listed here maps to a real column, and every processor named
 * is one the application really talks to. A privacy policy that describes a
 * different product is worse than none: it is a written statement that does
 * not match the system, which is the definition of a misrepresentation.
 *
 * Carrier registration for text messaging requires a public policy at a stable
 * URL, so this also has to stay reachable without signing in.
 */
export default function PrivacyPage() {
  return (
    <Section>
      <div className="max-w-3xl">
        <h1 className="text-3xl font-semibold text-navy md:text-4xl">Privacy policy</h1>
        <p className="mt-4 text-sm text-muted">
          Version {PRIVACY_VERSION} · {site.name}, operated by {site.legalEntity} ·
          Service area: {site.serviceArea}
        </p>

        <p className="mt-8 leading-relaxed text-body">
          This explains what we collect, why we hold it, who else sees it, and how long
          we keep it. It covers the Homewick website and the service itself.
        </p>

        <div className="mt-12 space-y-10">
          <Clause n="1" title="What we collect">
            <p>When you book, you give us:</p>
            <ul>
              <li>Your name, email address and phone number.</li>
              <li>
                The address to be cleaned, the size of the home, and whether there are
                pets.
              </li>
              <li>
                How we get in. This may be a door code, a gate code, or where a key is
                left. See section 3, because we treat this differently to everything
                else.
              </li>
              <li>Anything you type into the notes, such as access quirks or priorities.</li>
            </ul>
            <p>The system also records, without you entering it:</p>
            <ul>
              <li>
                Your IP address and browser identifier at the moment you accept the
                service agreement, as evidence of what you agreed to and when.
              </li>
              <li>
                Which cleanings happened, what was charged, which add-ons were chosen,
                and any rating or comment you leave afterwards.
              </li>
              <li>
                A cookie that keeps you signed in to your account. It holds a random
                value and nothing about you.
              </li>
              <li>
                Which pages were visited, which site you arrived from, roughly where in
                the world the visit came from, and what kind of device and browser it
                used. This is counted in totals to tell us whether the site is working
                and how quickly it loads. It sets no cookie, it does not follow you to
                other websites, and it is not tied to your account or to your booking.
              </li>
            </ul>
            <p>
              We never see or store your card number. Card details are entered on
              Stripe&rsquo;s own payment page and stay with Stripe.
            </p>
          </Clause>

          <Clause n="2" title="Why we hold it">
            <p>
              To clean your home, take payment for it, and tell you when we are coming.
              Your address and access details go to the cleaner assigned to your visit,
              because they cannot do the job without them.
            </p>
            <p>
              We do not sell your information, and we do not share it for anybody
              else&rsquo;s advertising.
            </p>
          </Clause>

          <Clause n="3" title="Entry codes and keys">
            <p>
              Access details are encrypted before they are stored, using a key held
              outside the database. Somebody who obtained a copy of our database would
              not be able to read them.
            </p>
            <p>
              They are only readable on the day of your visit, and only by the person
              assigned to it. Every time a code is shown, we record who looked and when.
            </p>
            <p>
              If your code changes, update it in your account or tell us. If you stop
              using us, ask and we will delete it.
            </p>
          </Clause>

          <Clause n="4" title="Who else handles it">
            <p>
              We use a small number of companies to run the service. Each sees only what
              it needs to.
            </p>
            <ul>
              <li>
                <strong>Stripe</strong> takes payments and holds your card details. We
                receive confirmation that a payment succeeded and the last digits of the
                card, never the number.
              </li>
              <li>
                <strong>Resend</strong> sends our emails, so it processes your email
                address and the content of those messages.
              </li>
              <li>
                <strong>Supabase</strong> hosts the database where the rest of this
                lives.
              </li>
              <li>
                <strong>Vercel</strong> hosts the website and processes the requests your
                browser makes to it. It also produces the visit and page-speed totals
                described in section 1. Pages that are reached through a link we emailed
                you have the unique part of that link removed before it is counted, so
                the link cannot be reused by anybody looking at those totals.
              </li>
            </ul>
            <p>
              We may also be required to disclose information by law, or to protect
              somebody&rsquo;s safety or our legal rights.
            </p>
          </Clause>

          <Clause n="5" title="Text messages">
            <p>
              If you tick the box at booking, we may send you service text messages about
              scheduling: a confirmation when you book, and a reminder the day before a
              visit. We do not send marketing texts, and consent to service messages is
              not a condition of purchase.
            </p>
            <p>
              Message frequency depends on how often you are cleaned. Message and data
              rates may apply. Reply STOP at any time to stop them, or HELP for help.
              Stopping texts does not affect your cleanings or your emails.
            </p>
            <p>
              Your phone number is not sold, and it is not shared with anybody for their
              own marketing. It reaches our messaging provider only so the message can be
              delivered.
            </p>
          </Clause>

          <Clause n="6" title="How long we keep it">
            <p>
              Booking and payment records are kept for seven years, because tax and
              accounting rules require it.
            </p>
            <p>
              Access details are kept while you are a customer and deleted on request.
              Sign-in links expire after fifteen minutes. Signed-in sessions expire after
              thirty days of not being used.
            </p>
          </Clause>

          <Clause n="7" title="Your choices">
            <p>
              Texas residents may ask us to confirm what we hold about you, give you a
              copy, correct it, or delete it, and may appeal if we refuse. We will not
              treat you differently for asking.
            </p>
            <p>
              To do any of that, or to ask a question about this policy,{" "}
              {site.email ? (
                <a href={`mailto:${site.email}`} className="text-accent underline">
                  email us at {site.email}
                </a>
              ) : (
                "contact us"
              )}
              . We may need to confirm you are who you say you are before acting, which
              usually means replying from the address you booked with.
            </p>
            <p>
              Some information cannot be deleted while it is still needed, such as a
              record of a payment we are required to keep. We will say so if that is the
              case.
            </p>
          </Clause>

          <Clause n="8" title="Children">
            <p>
              This service is for adults. We do not knowingly collect information from
              anybody under 18.
            </p>
          </Clause>

          <Clause n="9" title="Changes">
            <p>
              If this policy changes we will update the version at the top of this page.
              Where a change materially affects what we do with your information, we will
              tell you by email rather than relying on you re-reading this.
            </p>
          </Clause>
        </div>

        <p className="mt-12 text-sm leading-relaxed text-muted">
          This policy describes what the service actually does. It has not been reviewed
          by a lawyer, and it is not a substitute for advice about your own
          circumstances. See also our{" "}
          <Link href="/terms" className="text-accent underline">
            service agreement
          </Link>
          .
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
