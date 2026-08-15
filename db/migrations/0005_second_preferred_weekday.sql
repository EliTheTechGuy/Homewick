-- A remembered weekday for each of the two cleanings in a period.
--
-- Until now a member had one preferred weekday and both visits followed it, a
-- fortnight apart. Members want the two independently: the first on a Tuesday
-- and the second on a Wednesday if that is what suits them.
--
-- preferred_weekday stays as the first cleaning so nothing existing changes.
-- Null here means the second follows the first, which is exactly what every
-- current subscription already does.

alter table subscriptions
  add column preferred_weekday_second smallint
    check (preferred_weekday_second between 0 and 6);

comment on column subscriptions.preferred_weekday is
  'Weekday for the first cleaning of each period. 0 is Sunday.';
comment on column subscriptions.preferred_weekday_second is
  'Weekday for the second cleaning. Null means follow the first.';
