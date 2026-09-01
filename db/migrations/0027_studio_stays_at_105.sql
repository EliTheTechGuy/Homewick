-- Studio stays at $105 after all.
--
-- 0026 moved the once-a-month tier to 110/150/210. The studio number is going
-- back to 105, so only 2 Bed and 3 Bed actually change from where they were.
--
-- A separate migration rather than an edit to 0026, because the runner
-- checksums every applied file and refuses one whose contents changed under
-- it. That guard is doing its job here: 0026 has already run against the live
-- database, and quietly rewriting history it had already acted on is exactly
-- what it exists to prevent.
--
-- Corrected in place rather than closed and reopened. A row opened and shut
-- on the same day is not a price anybody was ever charged, and the unique
-- index on (unit_size, visits_included, effective_from) would reject the
-- replacement anyway. Studio reads as $105 throughout, which is what actually
-- happened: 110 was live for minutes, on a branch, with nobody on the tier.
update membership_prices
   set monthly_amount_cents = 10500
 where visits_included = 1
   and unit_size = 'studio_1br'
   and effective_to is null;
