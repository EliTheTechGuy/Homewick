-- unit_size describes an apartment, and a house does not have one.
--
-- The admin form used to ask for the "nearest bracket" on a house, which was
-- a question with no true answer: a 7 bed is not near any of Studio, 2 bed or
-- 3 bed, and whatever got picked was then stored as if it were a fact.
--
-- Nullable now, with a check that keeps it required where it means something.
-- A house carries its real shape in bedrooms, bathrooms and square feet.

alter table properties alter column unit_size drop not null;
alter table subscriptions alter column unit_size drop not null;

-- An apartment without a size is a booking nobody can price, so the rule that
-- mattered is kept rather than dropped along with the not null.
alter table properties drop constraint if exists properties_apartment_needs_size;
alter table properties add constraint properties_apartment_needs_size
  check (property_kind <> 'apartment' or unit_size is not null);

comment on column properties.unit_size is
  'Apartments only. Null on a house, which carries its shape in bedrooms, bathrooms and square_feet.';
comment on column subscriptions.unit_size is
  'Apartments only. Null on a house, whose price was agreed rather than read from a bracket.';
