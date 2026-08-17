-- Admin signs in with a password.
--
-- Chosen deliberately over the emailed link, knowing the trade: a password is
-- a different single factor rather than a stronger one. What it does buy is
-- that owning the mailbox is no longer enough to get in, and there is no
-- reset-by-email path here to undo that.
--
-- The cost is that a leaked or reused password is the whole game, which is why
-- failed attempts are counted and slowed, and why recovery is a command run by
-- somebody who already has the database credentials rather than an email link
-- anybody could trigger.

alter table admin_users add column password_hash text;

comment on column admin_users.password_hash is
  'scrypt, as salt:key in hex. Null means the account cannot sign in yet.';

-- The emailed sign-in link is gone, so its table goes with it. Sessions stay:
-- how somebody proves who they are changed, not how the session works.
drop table if exists admin_login_tokens;
