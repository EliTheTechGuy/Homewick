-- The once-a-month tier repriced: 105/152/209 becomes 110/150/210.
--
-- Must stay in step with MEMBERSHIP_TIERS in src/lib/pricing.ts. The pricing
-- page quotes from the catalog and billing reads this table, so a change
-- landing in one and not the other advertises one number and charges another.
-- A test in src/lib/schema.test.ts asserts the two agree and fails either way
-- round.
--
-- Superseded rather than overwritten, because this table is temporal. Closing
-- the old row and opening a new one keeps a record of what was advertised and
-- when, which is the thing you want when somebody says they were quoted less.
--
-- Nobody is on this tier yet, so nothing rebills. Existing subscriptions store
-- monthly_amount_cents on the subscription itself and are not read from here,
-- so a member's price never moves because the catalog did. That is what the
-- 30 days' notice clause in the terms is for, and it is a deliberate decision
-- rather than a side effect.
--
-- Studio now sits exactly on the one-time rate of $110. That is intentional:
-- this tier sells the booking and billing happening on their own rather than a
-- discount, and the card says so instead of advertising a saving of nothing.

update membership_prices
   set effective_to = current_date
 where visits_included = 1
   and effective_to is null;

-- Upserted rather than plainly inserted, because of the day this runs on.
-- Against the live database the rows being replaced were opened on an earlier
-- date and the insert is genuinely new. Against a database built from scratch
-- every migration runs today, so 0019 opened its rows this morning, the update
-- above just closed them, and a plain insert would collide on
-- (unit_size, visits_included, effective_from). Reopening the same row is the
-- correct answer there: a price that started and ended on the same day never
-- really existed.
insert into membership_prices (unit_size, monthly_amount_cents, visits_included, effective_from) values
  ('studio_1br', 11000, 1, current_date),
  ('2br_2ba',    15000, 1, current_date),
  ('3br_2ba',    21000, 1, current_date)
on conflict (unit_size, visits_included, effective_from) do update
  set monthly_amount_cents = excluded.monthly_amount_cents,
      effective_to = null;
