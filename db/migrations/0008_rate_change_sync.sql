-- Remember when a rate change failed to reach Stripe.
--
-- Changing apartment size writes the new rate to the database and then updates
-- Stripe. If that second step fails, the member has already been told in
-- writing what they will pay, and Stripe carries on charging the old amount.
-- Until now the only trace was one console line nobody reads.
--
-- This column is the retry queue. The daily job reconciles anything sitting in
-- it, so a Stripe outage delays the change rather than losing it.

alter table subscriptions
  add column stripe_sync_needed_at timestamptz;

comment on column subscriptions.stripe_sync_needed_at is
  'Set when a rate change did not reach Stripe. Cleared once it has. Null is healthy.';

-- Only the broken ones are ever scanned, so the index covers only those.
create index on subscriptions (stripe_sync_needed_at)
  where stripe_sync_needed_at is not null;
