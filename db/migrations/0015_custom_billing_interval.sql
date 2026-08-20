-- Billing on a cadence other than monthly.
--
-- A customer arriving from a lead platform wanted every three weeks, which the
-- monthly model cannot express: periods are anchored to billing_day, and
-- billing_day is constrained to 1 to 28 precisely so month arithmetic stays
-- safe. Three weeks does not divide into a month.
--
-- Deliberately additive and nullable. Null means monthly and takes the exact
-- code path it takes today, so every existing member is untouched and the
-- billing_day anchoring keeps doing its job. Only subscriptions that set this
-- take the new branch.
--
-- Days rather than a unit-and-count pair, because one integer cannot disagree
-- with itself. Stripe is given interval: day with this as interval_count,
-- which it accepts up to 365 and which was verified against the API before
-- this column existed.

alter table subscriptions
  add column if not exists interval_days smallint
    check (interval_days is null or interval_days between 7 and 365);

comment on column subscriptions.interval_days is
  'Null means the ordinary monthly cycle anchored to billing_day. A value means every N days from started_on, ignoring billing_day entirely.';

-- Created by hand in admin rather than through the public booking form, which
-- is worth knowing when a period looks unusual or a price does not match any
-- published rate.
alter table subscriptions
  add column if not exists created_by text;

comment on column subscriptions.created_by is
  'Who entered this if it did not come from the booking form. Null means the customer booked it themselves.';
