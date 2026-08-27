-- What time a cleaning actually starts.
--
-- Every visit in the system was nine in the morning. Not by decision: the
-- booking form never asked, so a time agreed on the phone had nowhere to go
-- and ended up written into the notes instead. The cleaner's own job page
-- then showed nine at the top and "arrival 10:00" in the instructions
-- underneath, on the screen somebody reads standing outside the house.
--
-- On the subscription rather than only on the visit, because a recurring
-- customer keeps their slot: every cleaning generated from here needs the
-- time that was agreed, not the default the generator would otherwise use.

alter table subscriptions
  add column if not exists visit_time time not null default '09:00';

comment on column subscriptions.visit_time is
  'When cleanings for this subscription start, in local time. Every generated visit takes it, so a customer keeps the slot that was agreed.';
