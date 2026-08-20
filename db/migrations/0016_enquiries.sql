-- Requests for work that cannot be priced from a published rate.
--
-- Houses are quoted by square footage rather than bedroom count, so they
-- cannot go through the booking form, which prices from a fixed matrix and
-- takes payment immediately. Somebody with a house needs to describe it, get a
-- number back, and only then book.
--
-- Deliberately separate from customers. An enquiry is not a customer yet, and
-- most of them never will be. Writing a customer row for every request would
-- fill the members list with people who never bought anything and would give
-- each of them a magic-link account they never asked for.
--
-- When one is accepted it becomes a real booking through admin, which creates
-- the customer properly at that point.

create table if not exists enquiries (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  email         citext not null,
  phone         text not null,

  -- Free text rather than a structured address. This is a lead, and demanding
  -- a parseable address before we have quoted anything loses people.
  address       text,
  -- Nullable because plenty of people genuinely do not know it, and a required
  -- field they cannot answer is a field they abandon the form on.
  square_feet   integer check (square_feet is null or square_feet between 100 and 30000),
  bedrooms      smallint check (bedrooms is null or bedrooms between 0 and 20),
  bathrooms     smallint check (bathrooms is null or bathrooms between 0 and 20),
  has_pets      boolean not null default false,

  service_type  text not null,
  -- What they said they wanted, in their words. Not a cadence we can act on
  -- until somebody has spoken to them.
  frequency     text,
  message       text,

  status        text not null default 'new'
                check (status in ('new', 'quoted', 'won', 'lost')),
  internal_notes text,

  -- Evidence of what was submitted and from where, same reasoning as the
  -- service agreement rows.
  ip_address    inet,
  user_agent    text,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- The admin view opens on whatever is still unanswered, which is the only
-- question this table exists to answer quickly.
create index if not exists enquiries_open_idx
  on enquiries (created_at desc) where status in ('new', 'quoted');

-- PostgREST exposes the public schema to the anon key, so every table needs
-- this. Nothing here is readable by anybody but the server.
alter table enquiries enable row level security;
