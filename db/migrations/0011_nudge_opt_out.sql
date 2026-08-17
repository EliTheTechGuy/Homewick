-- A way out of the reminder about the free add-on.
--
-- That message is the only one here nobody asked for: it arrives on a
-- schedule, it is promotional in tone, and it exists to sell the value of a
-- benefit rather than to deliver a service. Under CAN-SPAM that wants an
-- unsubscribe, and honestly it wants one anyway.
--
-- Deliberately narrow. Opting out of the nudge must not stop the reminder the
-- morning before a visit, because somebody who does not know a cleaner is
-- coming does not get cleaned. Those are notifications about work they have
-- paid for, not marketing, and one checkbox for both would trade a legal box
-- tick for a worse service.

alter table customers add column nudge_opt_out_at timestamptz;

comment on column customers.nudge_opt_out_at is
  'When they asked to stop the free add-on reminder. Null means they still get it. '
  'Never affects visit reminders or anything transactional.';
