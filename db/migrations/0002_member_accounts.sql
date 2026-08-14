-- Member accounts: passwordless sign-in by emailed link.
--
-- There is no password anywhere in this design. A member proves they control
-- the email address they booked with, which is the same proof a password
-- reset would give — without a credential store sitting in the same database
-- as customers' door codes.
--
-- Both tables hold only SHA-256 hashes. The raw token lives in the emailed URL
-- and in the member's cookie; a dump of this database yields nothing that can
-- be replayed.

-- One-time sign-in links.
create table member_login_tokens (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id) on delete cascade,
  token_hash  text not null unique,
  expires_at  timestamptz not null,
  used_at     timestamptz,
  requested_ip inet,
  created_at  timestamptz not null default now()
);

create index on member_login_tokens (customer_id, created_at desc);
-- Unused, unexpired tokens are the only ones worth scanning on verify.
create index on member_login_tokens (expires_at) where used_at is null;

-- Signed-in sessions. Stored rather than self-contained so a session can be
-- revoked — signing out, or a member reporting a lost phone, has to actually
-- end access rather than wait for a token to expire.
create table member_sessions (
  id           uuid primary key default gen_random_uuid(),
  customer_id  uuid not null references customers(id) on delete cascade,
  token_hash   text not null unique,
  expires_at   timestamptz not null,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index on member_sessions (customer_id);
create index on member_sessions (expires_at);

-- Same posture as every other table: reachable only over a real Postgres
-- connection, never through PostgREST with the anon key.
alter table member_login_tokens enable row level security;
alter table member_sessions     enable row level security;
