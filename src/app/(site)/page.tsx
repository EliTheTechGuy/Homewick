import Link from "next/link";
import Image from "next/image";
import { ButtonLink, Card, CheckIcon, Section, SectionHeading } from "@/components/ui";
import { MembershipCards } from "@/components/MembershipCards";
import { AddOnList } from "@/components/AddOnList";
import { MEMBER_BENEFITS } from "@/lib/pricing";
import { site } from "@/lib/site";

const steps = [
  {
    n: "01",
    title: "Tell us about your place",
    body: "Size, service, add-ons, pets, and how we get in. Booking takes a couple of minutes.",
  },
  {
    n: "02",
    title: "We schedule your two visits",
    body: "Pick a preferred weekday. Your visits are placed inside your billing period and confirmed by email.",
  },
  {
    n: "03",
    title: "You come home to a clean apartment",
    body: "One charge a month covers both visits. Nothing to arrange, nothing to negotiate at the door.",
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
              A clean apartment, every two weeks, without thinking about it.
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted">
              Homewick is a membership cleaning service for apartments. Two cleanings
              a month, one flat charge, and a standard that does not move.
            </p>
            <div className="mt-9 flex flex-wrap gap-3">
              <ButtonLink href="/book">Book online</ButtonLink>
              <ButtonLink href="/membership" variant="secondary">
                See membership pricing
              </ButtonLink>
            </div>
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
          title="Three steps, then it runs itself."
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

      {/* Membership */}
      <Section tinted>
        <SectionHeading
          eyebrow="Membership"
          title="Two cleanings every month, one simple charge."
          lead="Members save 15% on every visit compared with booking one at a time."
          centered
        />
        <MembershipCards className="mt-12" />
        <div className="mx-auto mt-12 max-w-3xl">
          <Card>
            <h3 className="text-lg font-semibold text-navy">What membership includes</h3>
            <ul className="mt-4 grid gap-3 sm:grid-cols-2">
              {MEMBER_BENEFITS.map((b) => (
                <li key={b} className="flex gap-3 text-sm leading-relaxed text-body">
                  <CheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                  <span>{b}</span>
                </li>
              ))}
            </ul>
            <p className="mt-5 border-t border-hairline pt-4 text-sm text-muted">
              Two cleanings per billing period. Unused visits do not roll over.{" "}
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
            lead="We specialize in apartments, which means we are not learning your floor plan on the job. What you are paying for is that the result is the same every time."
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
              Spotless apartments for easier living
            </h2>
            <p className="mt-2 text-white/80">
              Serving the {site.serviceArea}. Book in a couple of minutes.
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
