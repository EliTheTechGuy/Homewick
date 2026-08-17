-- Failed admin sign-ins, so they can be slowed down and noticed.
--
-- Admin is one shared password, and it unlocks every customer's entry codes.
-- There was no lockout, no delay and no record, so an attacker could guess at
-- full speed for as long as they liked and leave no trace of having tried.
--
-- Kept in the database rather than in memory because the site runs as many
-- short-lived serverless instances, and a counter in one of them is no counter
-- at all.

create table admin_login_attempts (
  id          bigserial primary key,
  ip          text not null,
  attempted_at timestamptz not null default now()
);

-- Every read asks "how many from this address recently".
create index on admin_login_attempts (ip, attempted_at desc);

alter table admin_login_attempts enable row level security;
