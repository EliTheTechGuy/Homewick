-- Crews, and the pay model that houses use.
--
-- Two changes that belong together, because neither is useful alone.
--
-- 1. A visit can hold more than one cleaner. Houses need it: a 4 bed 3 bath
--    takes two people, and until now assigned_cleaner_id could hold one, so
--    the second person got no job email, no entry code, and no pay.
--
-- 2. Houses and apartments are paid differently and always were. An apartment
--    is one cleaner on their own percentage. A house splits half the job price
--    across the crew, with the lead taking a flat premium off the top first.
--    Trying to express both with one column is what made the second cleaner
--    invisible.

-- Which pay model applies, and what shape the place is. Apartments keep their
-- fixed sizes; a house is any shape at all, which is why unit_size cannot
-- describe one.
do $$ begin
  create type property_kind as enum ('apartment', 'house');
exception when duplicate_object then null;
end $$;

alter table properties
  add column if not exists property_kind property_kind not null default 'apartment',
  -- Houses only. Nullable because an apartment's size is its unit_size, and a
  -- number invented to fill the column would look like a fact.
  add column if not exists bedrooms smallint
    check (bedrooms is null or bedrooms between 0 and 20),
  -- Numeric, not an integer. A 4 bed 3.5 bath is an ordinary house, and
  -- rounding somebody's home to 3 or 4 baths misdescribes what we are cleaning.
  add column if not exists bathrooms numeric(3,1)
    check (bathrooms is null or bathrooms between 0 and 20),
  add column if not exists square_feet integer
    check (square_feet is null or square_feet between 100 and 30000);

comment on column properties.property_kind is
  'Decides which pay model a visit here uses: apartment pays one cleaner their own percentage, house splits a pool across the crew.';

-- Who is on a job. Replaces visits.assigned_cleaner_id, which could only ever
-- name one person.
create table if not exists visit_cleaners (
  visit_id      uuid not null references visits(id) on delete cascade,
  cleaner_id    uuid not null references cleaners(id) on delete restrict,

  -- Exactly one per visit, enforced by the partial unique index below. The
  -- lead takes the premium and is who to ring from the doorstep.
  is_lead       boolean not null default false,

  -- Snapshotted when assigned, never recalculated. Changing a rate or adding a
  -- third cleaner must not silently restate what somebody was already owed for
  -- work they have done.
  pay_cents     integer check (pay_cents is null or pay_cents >= 0),

  paid_at       timestamptz,
  payment_ref   text,

  assigned_at   timestamptz not null default now(),

  primary key (visit_id, cleaner_id),
  -- Same rule as before: nothing is settled without an amount, or the year-end
  -- 1099 totals quietly undercount.
  constraint visit_cleaners_paid_needs_amount
    check (paid_at is null or pay_cents is not null)
);

-- One lead per visit. A crew with two leads has no answer to "who do I call",
-- and would pay the premium twice.
create unique index if not exists visit_cleaners_one_lead
  on visit_cleaners (visit_id) where is_lead;

-- The weekly payout run asks one question: who is owed what.
create index if not exists visit_cleaners_unpaid
  on visit_cleaners (cleaner_id) where paid_at is null;

alter table visit_cleaners enable row level security;

-- Carry across anything already assigned, as the lead of a crew of one. There
-- is nothing to move today, the table is empty, but a migration that only works
-- on an empty database is a trap for whoever runs it next.
insert into visit_cleaners (visit_id, cleaner_id, is_lead, pay_cents, paid_at, payment_ref)
select id, assigned_cleaner_id, true, cleaner_pay_cents, cleaner_paid_at, cleaner_payment_ref
  from visits
 where assigned_cleaner_id is not null
on conflict do nothing;
