-- Add-ons repriced against the local market.
--
-- Must stay in step with ADD_ONS in src/lib/pricing.ts. The booking form
-- quotes from that list and insertAddOns bills from this table, so a change
-- landing in one and not the other quotes a customer one number and charges
-- them another. A test in src/lib/schema.test.ts asserts the two agree, and
-- it fails if this migration is edited without the catalog, or the other way
-- around.
--
-- No history table here, and none is needed: visit_add_ons stores
-- price_cents_at_time, so every add-on already sold keeps the price it was
-- sold at.

update add_ons set price_cents = 2500 where code = 'oven';      -- was 3500
update add_ons set price_cents = 3000 where code = 'fridge';     -- was 3500
update add_ons set price_cents = 3000 where code = 'windows';    -- was 4500
update add_ons set price_cents = 2000 where code = 'balcony';    -- was 2500
update add_ons set price_cents = 2500 where code = 'cabinets';   -- was 4500
update add_ons set price_cents = 1500 where code = 'laundry';    -- was 2500
