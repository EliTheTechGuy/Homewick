-- A booking that has not been paid for is not a booking.
--
-- Until now a membership was written as 'active' and its visits as 'scheduled'
-- before Stripe was ever contacted. Somebody who reached the payment page and
-- closed the tab therefore got a live membership: the daily job kept topping
-- up their billing periods and visits for ever, the morning reminder went out,
-- and a cleaner was dispatched. Two cleanings a month, indefinitely, for a
-- customer who was never charged a penny.
--
-- These states are the fix. A booking starts here and is promoted only when
-- Stripe confirms payment.
--
-- Every query that drives real work already filters on the states it wants
-- rather than excluding the ones it does not, so adding a value nobody selects
-- keeps unpaid rows out of visit generation, reminders and the schedule by
-- construction rather than by remembering to exclude them everywhere.

alter type subscription_state add value if not exists 'pending_payment';
alter type visit_state        add value if not exists 'pending_payment';
