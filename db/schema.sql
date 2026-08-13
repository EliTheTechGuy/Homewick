-- Homewick Cleaning — Postgres schema
-- All money stored as integer cents. Never floats.

create extension if not exists "pgcrypto";
create extension if not exists "citext";

-- ---------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------

create type unit_size          as enum ('studio_1br', '2br_2ba', '3br_2ba');
create type service_type       as enum ('standard', 'deep', 'move_out');
create type subscription_state as enum ('active', 'paused', 'pending_cancellation', 'canceled');
create type visit_state        as enum ('scheduled', 'assigned', 'completed', 'skipped', 'canceled');
create type visit_origin       as enum ('membership', 'one_off');
create type photo_kind         as enum ('before', 'after', 'issue');
create type feedback_channel   as enum ('sms', 'email');
create type recovery_state     as enum ('none', 'needed', 'in_progress', 'resolved');

-- ---------------------------------------------------------------
-- People
-- ---------------------------------------------------------------

create table customers (
  id                 uuid primary key default gen_random_uuid(),
  stripe_customer_id text unique,
  first_name         text not null,
  last_name          text not null,
  email              citext not null unique,
  phone              text not null,
  sms_consent_at     timestamptz,
  notes              text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create table cleaners (
  id           uuid primary key default gen_random_uuid(),
  first_name   text not null,
  last_name    text not null,
  phone        text not null,
  email        citext unique,
  hired_on     date,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------
-- Properties
-- ---------------------------------------------------------------

create table properties (
  id            uuid primary key default gen_random_uuid(),
  customer_id   uuid not null references customers(id) on delete restrict,
  line1         text not null,
  line2         text,
  city          text not null,
  state         text not null default 'TX',
  postal_code   text not null,
  unit_size     unit_size not null,
  has_pets      boolean not null default false,
  parking_notes text,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now()
);

create index on properties (customer_id);

-- Entry codes live apart from everything else. A leak here is a burglary,
-- not an embarrassment. Encrypt at rest with a key held outside the DB,
-- restrict reads to the day of service, and log every access below.
create table property_access_secrets (
  property_id           uuid primary key references properties(id) on delete cascade,
  gate_code_enc         bytea,
  door_code_enc         bytea,
  key_location_enc      bytea,
  alarm_instructions_enc bytea,
  updated_at            timestamptz not null default now()
);

create table access_reveals (
  id          bigserial primary key,
  property_id uuid not null references properties(id) on delete cascade,
  actor       text not null,
  visit_id    uuid,
  revealed_at timestamptz not null default now()
);

create index on access_reveals (property_id, revealed_at desc);

-- ---------------------------------------------------------------
-- Price book — dated rows, never updated in place.
-- This is what makes "launch pricing" and the annual review work:
-- close the old row with effective_to, insert a new one.
-- ---------------------------------------------------------------

create table service_prices (
  id             uuid primary key default gen_random_uuid(),
  unit_size      unit_size not null,
  service_type   service_type not null,
  amount_cents   integer not null check (amount_cents >= 0),
  effective_from date not null,
  effective_to   date,
  check (effective_to is null or effective_to > effective_from)
);

create unique index on service_prices (unit_size, service_type, effective_from);

create table membership_prices (
  id                   uuid primary key default gen_random_uuid(),
  unit_size            unit_size not null,
  monthly_amount_cents integer not null check (monthly_amount_cents >= 0),
  visits_included      smallint not null default 2,
  effective_from       date not null,
  effective_to         date
);

create unique index on membership_prices (unit_size, effective_from);

create table add_ons (
  id                 uuid primary key default gen_random_uuid(),
  code               text not null unique,
  name               text not null,
  price_cents        integer not null check (price_cents >= 0),
  free_perk_eligible boolean not null default false,
  is_active          boolean not null default true,
  sort_order         smallint not null default 0
);

-- ---------------------------------------------------------------
-- Subscriptions
--
-- The rate is COPIED onto the subscription, not looked up. That's how you
-- grandfather early members when list price rises.
--
-- Cancellation is a state, not a delete: 14 days' notice means
-- cancel_requested_at is set, ends_on is computed, and visits keep
-- generating until that date.
--
-- A rate change is scheduled ahead: pending_amount_cents plus its effective
-- date give you the 30-day notice window we promised in the terms.
-- ---------------------------------------------------------------

create table subscriptions (
  id                          uuid primary key default gen_random_uuid(),
  customer_id                 uuid not null references customers(id) on delete restrict,
  property_id                 uuid not null references properties(id) on delete restrict,
  unit_size                   unit_size not null,
  status                      subscription_state not null default 'active',
  monthly_amount_cents        integer not null check (monthly_amount_cents >= 0),
  visits_per_period           smallint not null default 2,
  pet_surcharge_cents         integer not null default 0,
  preferred_weekday           smallint check (preferred_weekday between 0 and 6),
  stripe_subscription_id      text unique,
  started_on                  date not null,
  billing_day                 smallint not null check (billing_day between 1 and 28),
  pending_amount_cents        integer check (pending_amount_cents >= 0),
  pending_amount_effective_on date,
  notice_sent_at              timestamptz,
  cancel_requested_at         timestamptz,
  ends_on                     date,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

create index on subscriptions (status);
create index on subscriptions (property_id);

-- The entitlement ledger. One row per billing month per subscription.
-- This is what enforces "two cleanings, no rollover" and resets the
-- free add-on. Without it you'd be doing date math against visits
-- forever and getting February wrong.
create table subscription_periods (
  id              uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references subscriptions(id) on delete cascade,
  period_start    date not null,
  period_end      date not null,
  visits_allotted smallint not null default 2,
  visits_used     smallint not null default 0,
  free_addon_used boolean not null default false,
  amount_cents    integer not null check (amount_cents >= 0),
  stripe_invoice_id text,
  check (period_end > period_start),
  check (visits_used <= visits_allotted)
);

create unique index on subscription_periods (subscription_id, period_start);

-- ---------------------------------------------------------------
-- Visits
--
-- Prices are snapshotted here. When list price changes next year, last
-- year's completed visits must not silently change value.
-- ---------------------------------------------------------------

create table visits (
  id                     uuid primary key default gen_random_uuid(),
  customer_id            uuid not null references customers(id) on delete restrict,
  property_id            uuid not null references properties(id) on delete restrict,
  subscription_id        uuid references subscriptions(id) on delete set null,
  period_id              uuid references subscription_periods(id) on delete set null,
  origin                 visit_origin not null,
  service_type           service_type not null,
  status                 visit_state not null default 'scheduled',
  scheduled_for          timestamptz not null,
  assigned_cleaner_id    uuid references cleaners(id) on delete set null,
  base_amount_cents      integer not null default 0 check (base_amount_cents >= 0),
  pet_surcharge_cents    integer not null default 0,
  addons_amount_cents    integer not null default 0,
  stripe_payment_intent_id text,
  completed_at           timestamptz,
  customer_instructions  text,
  internal_notes         text,
  created_at             timestamptz not null default now(),
  -- membership visits belong to a period; one-offs never do
  check (
    (origin = 'membership' and period_id is not null) or
    (origin = 'one_off'    and period_id is null)
  )
);

create index on visits (scheduled_for);
create index on visits (status, scheduled_for);
create index on visits (customer_id, scheduled_for desc);
create index on visits (assigned_cleaner_id, scheduled_for);

create table visit_add_ons (
  id                  uuid primary key default gen_random_uuid(),
  visit_id            uuid not null references visits(id) on delete cascade,
  add_on_id           uuid not null references add_ons(id) on delete restrict,
  price_cents_at_time integer not null check (price_cents_at_time >= 0),
  is_free_perk        boolean not null default false,
  unique (visit_id, add_on_id)
);

-- Only one free perk may be claimed per visit.
create unique index one_free_perk_per_visit
  on visit_add_ons (visit_id) where is_free_perk;

create table visit_photos (
  id          uuid primary key default gen_random_uuid(),
  visit_id    uuid not null references visits(id) on delete cascade,
  storage_key text not null,
  kind        photo_kind not null default 'after',
  uploaded_at timestamptz not null default now()
);

create index on visit_photos (visit_id);

-- ---------------------------------------------------------------
-- Post-clean feedback
--
-- Sent by SMS a few hours after completion. The rating drives service
-- recovery only — every customer gets the same public review link
-- regardless of what they answer. Routing only happy customers to a
-- review link violates Google's policies and the FTC's 2024 rule.
-- ---------------------------------------------------------------

create table visit_feedback (
  id              uuid primary key default gen_random_uuid(),
  visit_id        uuid not null unique references visits(id) on delete cascade,
  channel         feedback_channel not null default 'sms',
  rating          smallint check (rating between 1 and 5),
  response_text   text,
  sent_at         timestamptz,
  responded_at    timestamptz,
  recovery_status recovery_state not null default 'none',
  recovery_notes  text,
  created_at      timestamptz not null default now()
);

create index on visit_feedback (recovery_status) where recovery_status in ('needed', 'in_progress');

-- ---------------------------------------------------------------
-- Agreements — proof the customer accepted the terms, including the
-- laundry disclaimer and the annual rate review clause.
-- ---------------------------------------------------------------

create table service_agreements (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id) on delete cascade,
  version     text not null,
  accepted_at timestamptz not null default now(),
  ip_address  inet,
  user_agent  text
);

create index on service_agreements (customer_id, accepted_at desc);

-- ---------------------------------------------------------------
-- Seed: launch pricing (effective_to left null until the first review)
-- ---------------------------------------------------------------

insert into service_prices (unit_size, service_type, amount_cents, effective_from) values
  ('studio_1br', 'standard',  11000, current_date),
  ('studio_1br', 'deep',      16900, current_date),
  ('studio_1br', 'move_out',  20900, current_date),
  ('2br_2ba',    'standard',  15900, current_date),
  ('2br_2ba',    'deep',      23900, current_date),
  ('2br_2ba',    'move_out',  29900, current_date),
  ('3br_2ba',    'standard',  21900, current_date),
  ('3br_2ba',    'deep',      32900, current_date),
  ('3br_2ba',    'move_out',  39900, current_date);

insert into membership_prices (unit_size, monthly_amount_cents, effective_from) values
  ('studio_1br', 18900, current_date),
  ('2br_2ba',    26900, current_date),
  ('3br_2ba',    36900, current_date);

insert into add_ons (code, name, price_cents, free_perk_eligible, sort_order) values
  ('oven',        'Inside oven',          3500, true,  1),
  ('fridge',      'Inside refrigerator',  3500, true,  2),
  ('windows',     'Interior windows',     4500, true,  3),
  ('balcony',     'Balcony / patio',      2500, true,  4),
  ('cabinets',    'Cabinet interiors',    4500, false, 5),
  ('laundry',     'Laundry, per load',    2500, false, 6);
