-- Named admin accounts, replacing one shared password.
--
-- The shared password had three problems. Nobody could be removed without
-- changing it for everyone. Nothing recorded who was who, so access_reveals
-- stored whatever name the browser sent and could not be trusted as evidence
-- of who opened a customer's door code. And it could be guessed at, which the
-- throttle slowed but did not solve.
--
-- Passwordless, like the member side. There is no password anywhere in this
-- product now: nothing to leak, no reset flow, and no credential sitting in
-- the same database as the entry codes. Proving control of the mailbox is the
-- same proof a reset would give.

create table admin_users (
  id           uuid primary key default gen_random_uuid(),
  email        citext not null unique,
  name         text not null,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz
);

-- One-time sign-in links. Only hashes, so a dump yields nothing replayable.
create table admin_login_tokens (
  id            uuid primary key default gen_random_uuid(),
  admin_user_id uuid not null references admin_users(id) on delete cascade,
  token_hash    text not null unique,
  expires_at    timestamptz not null,
  used_at       timestamptz,
  requested_ip  text,
  created_at    timestamptz not null default now()
);

create index on admin_login_tokens (admin_user_id, created_at desc);
create index on admin_login_tokens (expires_at) where used_at is null;

-- Sessions, stored rather than self-contained so access can actually be
-- ended. Switching somebody off should log them out, not wait for a token to
-- expire on its own.
create table admin_sessions (
  id            uuid primary key default gen_random_uuid(),
  admin_user_id uuid not null references admin_users(id) on delete cascade,
  token_hash    text not null unique,
  expires_at    timestamptz not null,
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now()
);

create index on admin_sessions (admin_user_id);

alter table admin_users enable row level security;
alter table admin_login_tokens enable row level security;
alter table admin_sessions enable row level security;
