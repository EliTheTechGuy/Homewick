-- A record of transactional email we have sent, keyed by what caused it.
--
-- Stripe retries a webhook until it gets a 2xx, and can deliver the same event
-- more than once regardless. Without this, a retry sends a second "welcome to
-- your membership" — which reads as either a mistake or a double charge, and
-- is exactly the kind of thing that generates a support message on a business
-- with no support inbox yet.
--
-- The unique key is (event_key, kind): one Stripe event may legitimately
-- produce different emails, but never the same one twice.

create table email_deliveries (
  id          uuid primary key default gen_random_uuid(),
  event_key   text not null,
  kind        text not null,
  customer_id uuid references customers(id) on delete set null,
  recipient   citext,
  delivered   boolean not null default false,
  sent_at     timestamptz not null default now(),
  unique (event_key, kind)
);

create index on email_deliveries (customer_id, sent_at desc);

alter table email_deliveries enable row level security;
