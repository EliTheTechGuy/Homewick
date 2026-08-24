import Link from "next/link";
import Image from "next/image";
import { ButtonLink, Card, CheckIcon, Section, SectionHeading } from "@/components/ui";
import { MembershipCards } from "@/components/MembershipCards";
import { AddOnList } from "@/components/AddOnList";
import { MEMBERSHIP_TIERS, SERVICE_PRICES, SERVICE_TYPES } from "@/lib/pricing";
import { site } from "@/lib/site";

/**
 * Deliberately written for both ways of buying. The page used to describe the
 * membership as though it were the only option, which left somebody who wanted
 * one deep clean before a lease inspection with no idea whether we would do it.
 */
const steps = [
  {
    n: "01",
    title: "Tell us about your place",
    body: "Size, service, add-ons, pets, and how we get in. Booking takes a couple of minutes, and you see the price before you pay.",
  },
  {
    n: "02",
    title: "We schedule the visit",
    body: "Pick any day that suits you, weekends included. A single clean is booked for that date. A membership places two visits inside every billing period.",
  },
  {
    n: "03",
    title: "You come home to a clean place",
    body: "Paid online when you book, so there is nothing to arrange and nothing to negotiate at the door. Book again whenever you like, or put it on a membership so you never have to.",
  },
];

const standards = [
  "Flat pricing published up front, with no on-site quoting and no hidden fees",
  "Bed linens changed on every clean, member or not",
  "The same cleaner whenever scheduling allows",
  "Entry codes stored separately and encrypted, shared only with the assigned cleaner on the day",
  "If something is wrong, tell us within 48 hours and we come back",
];

export default function HomePage() {
  return (
    <>
      {/* Hero */}
      <section className="border-b border-hairline bg-panel">
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-5 py-20 md:py-28 lg:grid-cols-[1.15fr_1fr]">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">
              {site.serviceArea}
            </p>
            <h1 className="mt-4 text-4xl font-semibold leading-[1.1] text-navy md:text-6xl">
              A clean home, without the back and forth.
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted">
              Apartments and houses across the metroplex. Standard cleans, deep cleans,
              and move in and out. Book an apartment online in a couple of minutes at a
              published rate, or tell us about your house and we will quote it.
            </p>
            {/* Two doors, because the paragraph above promises two things and
                a house cannot be booked online. Both buttons used to lead to
                the apartment form and the apartment price list, so somebody
                with a house read that we clean houses and then found nowhere
                to go. The same fork already existed further down this page and
                simply never reached the top of it.

                Pricing drops to a link rather than a third button. It is the
                second most visited page on the site so it has to stay, but it
                is something to read, not one of the two things to do. */}
            <div className="mt-9 flex flex-wrap gap-3">
              <ButtonLink href="/book">Book an apartment clean</ButtonLink>
              <ButtonLink href="/services/residential" variant="secondary">
                Get a house quote
              </ButtonLink>
            </div>
            <p className="mt-5 text-sm text-muted">
              <Link
                href="/pricing"
                className="font-medium text-accent hover:underline"
              >
                See apartment pricing
              </Link>{" "}
              for every size and service.
            </p>
          </div>

          {/* priority, because this is the largest thing above the fold and
              lazy loading it would mean the hero arrives in two stages. */}
          {/* Shown on every size. Most people looking for a local cleaner are
              on a phone, and hiding the only photograph from them to save a
              little bandwidth is the wrong trade. Shorter crop on small
              screens so it does not push the buttons off the fold. */}
          <div className="relative aspect-[3/2] overflow-hidden rounded-2xl lg:aspect-[4/5]">
            <Image
              src="/photography/kitchen-counter.jpg"
              alt="A tidy kitchen counter with storage jars against white herringbone tile"
              fill
              // A 0px fallback made Next pick a 108px file for a 495px slot.
              // The image is hidden below lg, so the second branch never
              // applies, but it still has to describe a real size.
              sizes="(min-width: 1024px) 40vw, 100vw"
              className="object-cover"
              priority
            />
          </div>
        </div>
      </section>

      {/* How it works */}
      <Section>
        <SectionHeading
          eyebrow="How it works"
          title="Three steps, and we take it from there."
        />
        <div className="mt-12 grid gap-8 md:grid-cols-3">
          {steps.map((s) => (
            <div key={s.n}>
              <div className="text-sm font-semibold tracking-widest text-accent">{s.n}</div>
              <h3 className="mt-3 text-xl font-semibold text-navy">{s.title}</h3>
              <p className="mt-2 leading-relaxed text-muted">{s.body}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* A pause between two dense sections. Decorative, so it carries an
          empty alt rather than a description a screen reader would have to
          sit through on the way to the pricing. */}
      <div className="relative h-56 w-full md:h-72">
        <Image
          src="/photography/bedroom.jpg"
          alt=""
          fill
          sizes="100vw"
          className="object-cover"
        />
      </div>

      {/* Services.
          Sits ahead of the membership on purpose. Somebody arriving cold used
          to meet a subscription before they had been told what we clean or
          what it costs, and a good number of them wanted one deep clean before
          a lease inspection and left assuming we only sold memberships. What
          we do comes first; how to buy it repeatedly comes after. */}
      <Section>
        <SectionHeading
          eyebrow="What we do"
          title="Three cleans, whichever kind of home."
          lead="Apartment rates are published, so you can book and pay online. Houses are quoted by square footage, because a range wide enough to be safe would tell you nothing."
        />
        <div className="mt-12 grid gap-6 md:grid-cols-3">
          {SERVICE_TYPES.map((service) => {
            // The smallest apartment sets the "from" figure, so the number a
            // visitor sees is one somebody can actually pay rather than an
            // average nobody is charged.
            const from = Math.min(
              ...Object.values(SERVICE_PRICES).map((sizes) => sizes[service.id]),
            );
            return (
              <Card key={service.id}>
                <h3 className="text-xl font-semibold text-navy">{service.label}</h3>
                <p className="mt-1 text-sm font-medium text-accent">
                  from ${(from / 100).toFixed(0)}
                </p>
                <p className="mt-3 leading-relaxed text-muted">{service.blurb}</p>
              </Card>
            );
          })}
        </div>
        <div className="mt-10 flex flex-wrap gap-3">
          <ButtonLink href="/book">Book an apartment clean</ButtonLink>
          <ButtonLink href="/services/residential" variant="secondary">
            Get a house quote
          </ButtonLink>
        </div>
      </Section>

      {/* Membership */}
      <Section tinted>
        <SectionHeading
          eyebrow="Or join the membership"
          title="Cleaning on a schedule, handled for you."
          lead="For places that need it regularly. Once or twice a month on one charge, booked and billed without you thinking about it."
          centered
        />
        <MembershipCards className="mt-12" />
        <div className="mx-auto mt-12 max-w-3xl">
          <Card>
            <h3 className="text-lg font-semibold text-navy">
              What the twice-a-month membership includes
            </h3>
            <ul className="mt-4 grid gap-3 sm:grid-cols-2">
              {MEMBERSHIP_TIERS.twice_monthly.benefits.map((b) => (
                <li key={b} className="flex gap-3 text-sm leading-relaxed text-body">
                  <CheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                  <span>{b}</span>
                </li>
              ))}
            </ul>
            <p className="mt-5 border-t border-hairline pt-4 text-sm text-muted">
              Unused visits do not roll over, on either membership.{" "}
              <Link href="/membership" className="font-medium text-accent hover:underline">
                Read the membership terms
              </Link>
              .
            </p>
          </Card>
        </div>
      </Section>

      {/* Standards */}
      <Section>
        <div className="grid gap-12 md:grid-cols-2">
          <SectionHeading
            eyebrow="Our standards"
            title="The product is reliability."
            lead="Apartments are our specialism, which means we are not learning your floor plan on the job, and houses get the same crew and the same checklist. What you are paying for is that the result is the same every time."
          />
          <ul className="space-y-4">
            {standards.map((s) => (
              <li key={s} className="flex gap-3 leading-relaxed text-body">
                <CheckIcon className="mt-1 h-5 w-5 shrink-0 text-accent" />
                <span>{s}</span>
              </li>
            ))}
          </ul>
        </div>
      </Section>

      {/* Add-ons */}
      <Section tinted>
        <SectionHeading
          eyebrow="Add-ons"
          title="Extras, priced the same way."
          lead="Members get one of the eligible add-ons free each month, plus 10% off any additional ones."
        />
        <AddOnList className="mt-10" />
      </Section>

      {/* Closing CTA */}
      <section className="bg-accent">
        <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-6 px-5 py-14 md:flex-row md:items-center">
          <div>
            <h2 className="text-2xl font-semibold text-white md:text-3xl">
              Spotless homes for easier living
            </h2>
            <p className="mt-2 text-white/80">
              One clean or every month, whichever suits. Booking takes a couple of
              minutes.
            </p>
          </div>
          <ButtonLink href="/book" variant="onDark" className="shrink-0">
            Book today online
          </ButtonLink>
        </div>
      </section>
    </>
  );
}
