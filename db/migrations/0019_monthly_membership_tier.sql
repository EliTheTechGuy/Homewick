-- A once-a-month membership, and a new deep clean price.
--
-- Two changes, both to the published price catalog, both history-preserving.
-- Nothing here touches a subscription: an existing member's rate is
-- snapshotted onto their subscription row at signup, which is what stops a
-- price change from repricing anybody already signed up.

-- ---------------------------------------------------------------
-- Deep clean, repriced
--
-- The old rows are closed rather than updated, so a visit booked last week can
-- still be reconciled against the price that was published when it was sold.
-- ---------------------------------------------------------------

update service_prices
   set effective_to = current_date
 where service_type = 'deep'
   and effective_to is null
   and effective_from < current_date;

-- A price that was published today and changed again today never applied to
-- anything, and closing it would leave a row whose effective_to equals its
-- effective_from, which the table's own check constraint refuses. Replaced
-- rather than dated.
delete from service_prices
 where service_type = 'deep'
   and effective_from = current_date;

insert into service_prices (unit_size, service_type, amount_cents, effective_from) values
  ('studio_1br', 'deep', 16000, current_date),
  ('2br_2ba',    'deep', 22000, current_date),
  ('3br_2ba',    'deep', 28000, current_date);

-- ---------------------------------------------------------------
-- Membership prices now vary by frequency, not only by size
--
-- visits_included has been on this table since the start, defaulting to 2, but
-- the unique index ignored it. So the once-a-month price for a 2 bed and the
-- twice-a-month price for a 2 bed collided on the same day and only one of
-- them could exist.
-- ---------------------------------------------------------------

drop index if exists membership_prices_unit_size_effective_from_idx;

create unique index if not exists membership_prices_size_visits_from_idx
  on membership_prices (unit_size, visits_included, effective_from);

insert into membership_prices (unit_size, monthly_amount_cents, visits_included, effective_from) values
  ('studio_1br', 10500, 1, current_date),
  ('2br_2ba',    15200, 1, current_date),
  ('3br_2ba',    20900, 1, current_date);

comment on column membership_prices.visits_included is
  'Cleanings per billing period. 2 is the discounted tier, 1 is the once-a-month tier priced just under the one-time rate.';
