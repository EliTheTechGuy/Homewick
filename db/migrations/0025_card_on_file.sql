-- Keep a card, charge it the morning of the clean.
--
-- Pay-later solved the wrong half of the problem. A first-time customer who
-- has been burned before will not pay weeks ahead for work nobody has done
-- yet, and agreeing to that left us with no recourse at all: a staffed job, a
-- crew dispatched, and nothing but goodwill saying the money turns up.
--
-- This is the middle. She enters a card and is not charged. The job goes on
-- the board and can be staffed like any other. On the morning of the clean
-- somebody presses a button and the money moves.
--
-- Deliberately a third term rather than a flag on 'later'. The two are not
-- variations of one idea: 'later' means an invoice we have to chase, and this
-- means money we can already reach. Everywhere that asks "can I staff this
-- yet" wants them to behave alike, and everywhere that asks "how do I get
-- paid" needs to tell them apart.
--
-- Adding the value and nothing else that uses it, on purpose. Postgres allows
-- ALTER TYPE ADD VALUE inside a transaction, which is how the migration
-- runner executes every file, but forbids using the new value in that same
-- transaction. A default or a backfill referencing it here would fail.
alter type payment_terms add value if not exists 'card_on_file';

-- The card itself lives at Stripe. This is the handle to it, and it is on the
-- customer rather than the visit because a card belongs to a person: somebody
-- who books a second clean should not have to enter it again.
alter table customers
  add column if not exists stripe_payment_method_id text;

-- When the card was actually saved, which is not the same as having asked.
-- The link is emailed and then sat on for a day, and the difference between
-- "sent it and waiting" and "we can charge whenever" is the difference
-- between chasing her and leaving her alone.
alter table visits
  add column if not exists card_saved_at timestamptz;

comment on column customers.stripe_payment_method_id is
  'A card saved off-session for later charging. Set when a card_on_file setup checkout completes. Never the card itself, only Stripe''s handle to it.';
comment on column visits.card_saved_at is
  'When the customer finished saving a card for this booking. Null means the link was sent and not yet used, or never sent at all.';
