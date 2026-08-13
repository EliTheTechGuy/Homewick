# Homewick Cleaning

Membership apartment cleaning in the Dallas–Fort Worth metroplex, operated by
Mabaje & Co LLC. Customers pay one monthly charge and receive two cleanings;
one-time cleans are priced higher to push people toward membership.

This repository holds the public website, the booking flow, and an internal
admin view. There is no cleaner-facing app and no customer portal in v1 —
dispatch is manual, and Stripe's hosted portal covers card updates and
invoices.

## Stack

- **Next.js (App Router) + TypeScript** — marketing pages need SSR for local
  SEO, admin needs to be a dynamic app, and one framework covers both.
- **Tailwind v4** with the brand tokens defined in `src/app/globals.css`.
- **Postgres** (Supabase or Neon) via `pg`.
- **Stripe Billing + Checkout** — Stripe is the source of truth for money.
  There is deliberately no second billing ledger here. Card data never
  touches our servers, which keeps us at PCI SAQ-A.
- **Vercel Cron** — one daily job generates upcoming visits.

## Getting started

```bash
npm install
cp .env.example .env.local     # then fill it in
npm run db:migrate             # applies anything pending in db/migrations
npm run db:check               # end-to-end check, rolled back afterwards
npm run dev
```

## Changing the schema

`db/migrations` holds numbered SQL files that run in filename order. Each runs
in its own transaction and is recorded in `schema_migrations`, so it is applied
exactly once and a failure leaves the database untouched.

```bash
# add db/migrations/0002_add_house_pricing.sql, then:
npm run db:migrate -- --dry    # show what would run
npm run db:migrate             # apply it
```

Never edit a migration that has already run — the runner compares checksums and
refuses, because changing the file does not change the database. Write a new
one instead.

A database that already had the schema installed before migrations existed is
detected and baselined rather than rebuilt.

`db:migrate` and `db:check` read `.env.local` themselves, so the connection
string never needs to go on a command line or into shell history. `db:check`
does all of its work inside a transaction it rolls back, so it is safe to run
against a database that has real bookings in it.

## The connection string

Use the **pooled** string, under Project Settings → Database → Connection
string → Transaction pooler. It looks like this — note the project ref in the
username and port 6543:

```
postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres
```

This is not a preference. Supabase's direct host, `db.<ref>.supabase.co`,
publishes only an AAAA record, and Vercel's functions do not route IPv6, so
the direct string cannot connect from production at all. It also opens a
Postgres connection per function invocation, which exhausts the server under
any real traffic. The direct string is fine from a laptop, which is why it
works locally and then fails once deployed.

`npm test` runs the suite. It includes an integration test that applies
the real migration sequence to an in-process Postgres (PGlite) and drives the visit
generator against it, so schema and generator changes are checked without
needing a live database.

## Layout

```
db/migrations/                    numbered schema migrations
src/app/(site)/                  public site
src/app/admin/                   today-view, password-gated
src/app/api/stripe/webhook/      subscription state from Stripe
src/app/api/cron/daily/          visit generation
src/actions/                     server actions (booking, checkout, reveal)
src/lib/pricing.ts               pricing catalog, mirrors the seed rows
src/lib/membership-lifecycle.ts  periods, visit generation, cancellation
src/lib/dates.ts                 date-only helpers
src/lib/secrets.ts               entry-code encryption
```

## Things that are load-bearing

These are decisions rather than accidents; changing them breaks something
real.

- **`subscription_periods` is the entitlement ledger.** Two cleanings and one
  free add-on belong to a billing *period*, not a calendar month. Counting
  visits by date range at query time gets February wrong and breaks on
  mid-month signups.

- **`billing_day` is constrained to 1–28.** Anchoring to the 31st inherits
  every February bug there is.

- **Money is integer cents.** Never floats.

- **Prices are snapshotted** onto the subscription at signup and onto each
  visit. Raising list price must not reprice existing members or restate the
  value of last year's completed visits.

- **Date-only values are `YYYY-MM-DD` strings, not `Date` objects.** Cleaning
  is a local-time business. The single conversion to an absolute instant
  happens in SQL, explicitly in `America/Chicago`.

- **The visit generator is idempotent.** It runs daily and must be safe to run
  twice.

- **`claimFreePerk` locks the period row.** Without `for update`, two
  near-simultaneous requests both read `free_addon_used = false` and you hand
  out two free ovens.

- **Entry codes are encrypted with a key held outside the database**, readable
  only on the day of service, and every read is written to `access_reveals`.
  A leak here is a burglary, not an embarrassment.

- **Cancellation is a state, not a delete.** Visits keep generating until the
  computed end date.

- **Row-level security is enabled on every table.** This matters most on
  Supabase, where anything in the `public` schema is served over HTTP by
  PostgREST — without RLS the anon key, which ships in browser bundles by
  design, would read the customer list, home addresses, and the access-secret
  rows. RLS is on with no policies except public read on the price book, which
  denies everything else through PostgREST. The app is unaffected because it
  connects as the table owner, and owners bypass RLS unless it is forced.

## Compliance guardrails

Do not add content that breaks these.

- No fabricated testimonials, customer names, quotes, star ratings, or review
  counts — not even as placeholder copy.
- Do not display "Licensed, Bonded & Insured" until the business holds both a
  general liability policy and a janitorial service bond. Bonded is a specific
  product, not a synonym for insured.
- No claims about years in business, homes cleaned, or team size.
- No review gating. Every customer gets the same review link regardless of
  their rating; the internal rating drives service recovery only.
- Never publish service durations. Publishing "1 hr 30 min" turns every visit
  into a stopwatch negotiation.
- Service area is Dallas–Fort Worth.

## Before SMS feedback can ship

Phase 3 is not built yet. When it is, it needs A2P 10DLC registration with the
SMS provider (takes days — start early), the consent checkbox already present
in the booking form, STOP in the first message of every thread, and no sending
before 8am or after 9pm local. TCPA penalties are per message.

## Open decisions

These are unresolved and must not be guessed at in code.

- **Email address.** The domain question is settled — it is
  `homewickcleaning.net`. The `.com` belongs to someone else: it serves a live
  site on Squarespace and has Google Workspace MX records, so mail sent to
  `info@homewickcleaning.com` reaches a stranger. Anywhere that address still
  appears offline — business cards, invoices, the Wix site — is sending
  enquiries to the wrong company.

  What remains is mail hosting. `homewickcleaning.net` has no MX records
  today, so `info@homewickcleaning.net` would bounce.
  `NEXT_PUBLIC_CONTACT_EMAIL` stays unset until mail is actually delivered,
  and the footer omits contact details while it is.
- **Employee vs contractor classification** for cleaners.
- **House pricing tier** — current pricing is apartments only.
- **A one-clean-per-month membership tier.**
- **Whether the 2BR/2BA standard moves from $159 to $165.**
- **Cancellation generosity** — current logic bills through the following
  period when notice is under 14 days.
