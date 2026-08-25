-- Hand the free monthly add-on to somebody the tier rules would not give it to,
-- or take it away from somebody they would.
--
-- Recurring customers entered by hand were priced in a phone call, and what
-- was agreed in that call is not written down anywhere the system can read.
-- Usually the add-on was not part of it. Sometimes it was, or gets offered
-- later as a goodwill gesture, and there was no way to record either.
--
-- Nullable on purpose, and null is not the same as false. Null means follow
-- whatever the tier says, so a published membership keeps working without
-- every row having to carry a copy of its tier's rule and drift from it. A
-- value means somebody decided for this customer specifically.

alter table subscriptions
  add column if not exists free_add_on_override boolean;

comment on column subscriptions.free_add_on_override is
  'Null follows the tier. True or false is a decision made for this customer, which is how a hand-agreed arrangement records what was promised.';
