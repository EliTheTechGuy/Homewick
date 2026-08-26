-- Agreeing a job now and collecting for it later.
--
-- A first-time customer who has been let down before will not always pay up
-- front, and until now that was not something the system could express. A
-- booking either had a payment link fired at it the moment it was created or
-- it did not exist.
--
-- The distinction this column draws is not "paid" versus "unpaid". It is
-- "somebody wandered off mid-checkout" versus "we agreed this and they are
-- paying nearer the day". Those were the same state, pending_payment, and
-- telling them apart is what makes the second one safe:
--
--   * a pay-later job appears on the board and can be staffed, because a
--     cleaner has to know where to be, and an abandoned checkout must not
--   * Stripe expiring a link cancels an abandoned checkout, and must not
--     cancel a job that has already had cleaners assigned to it

do $$ begin
  create type payment_terms as enum ('on_booking', 'later');
exception when duplicate_object then null;
end $$;

alter table visits
  add column if not exists payment_terms payment_terms not null default 'on_booking';

alter table subscriptions
  add column if not exists payment_terms payment_terms not null default 'on_booking';

comment on column visits.payment_terms is
  'on_booking is the normal path: nothing is scheduled until it is paid for. later means the job was agreed and is staffed before payment, and it is what keeps an expiring link from cancelling it.';
comment on column subscriptions.payment_terms is
  'on_booking is the normal path. later means the first charge is collected nearer the day, so the visits are real before Stripe has ever seen this customer.';
