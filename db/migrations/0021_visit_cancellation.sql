-- Calling off a one-time clean, with an audit trail.
--
-- A cancellation moves money, so it needs to be a fact on the row rather than
-- something inferred from the status. Three questions have to be answerable
-- afterwards without opening Stripe: when was it called off, what did we keep,
-- and which refund covered it.
--
-- stripe_refund_id is also the guard against paying somebody twice. The action
-- takes a row lock and refuses when one is already there, so a double click, a
-- retried request, or two tabs cannot each issue a refund.

alter table visits
  add column if not exists canceled_at timestamptz,
  add column if not exists cancellation_fee_cents integer not null default 0
    check (cancellation_fee_cents >= 0),
  add column if not exists stripe_refund_id text;

comment on column visits.canceled_at is
  'When the visit was called off. Null on a visit canceled before this existed.';
comment on column visits.cancellation_fee_cents is
  'Kept from the payment because the notice was short. Zero when refunded in full.';
comment on column visits.stripe_refund_id is
  'The refund that settled it, and the lock that stops a second one being issued.';
