-- What a cleaner earns for a visit, and whether it has been settled.
--
-- Contractors, not employees, so this is a fee per job rather than an hourly
-- wage. It is stored on the visit rather than derived from the cleaner's
-- current rate, because a rate change must not silently rewrite what somebody
-- was owed for work already done. That is the same reason prices are
-- snapshotted on visits.
--
-- Payment itself happens outside the system for now, by bank transfer. This
-- records what is owed and what has been paid, which is what makes a weekly
-- run possible and what the 1099 totals come from at year end.

alter table cleaners
  -- Share of the visit price, in basis points, so 4500 is 45%. Integer maths
  -- throughout, for the same reason money is held in cents. Nullable because a
  -- cleaner can exist before their rate is agreed.
  add column if not exists pay_percent_bp smallint
    check (pay_percent_bp is null or pay_percent_bp between 0 and 10000);

alter table visits
  -- Snapshotted when the cleaner is assigned. Null means nobody is assigned or
  -- no rate was set, which the admin view surfaces rather than treating as
  -- zero: owing somebody nothing and not knowing what you owe them are very
  -- different, and only one of them is a mistake.
  add column if not exists cleaner_pay_cents integer
    check (cleaner_pay_cents is null or cleaner_pay_cents >= 0),

  -- When it was actually paid. Null means outstanding. A whole weekly run
  -- shares one timestamp, which is what groups it back together afterwards.
  add column if not exists cleaner_paid_at timestamptz,

  -- Free text: "Zelle 24 Aug", a bank reference, a cheque number. Whatever is
  -- needed to reconcile against a bank statement months later.
  add column if not exists cleaner_payment_ref text;

-- Nothing can be marked paid without an amount, or the year-end totals silently
-- undercount. Enforced here rather than only in the application, because this
-- is the sort of rule that gets bypassed by a hand-written UPDATE at 11pm.
alter table visits
  drop constraint if exists visits_paid_needs_amount;
alter table visits
  add constraint visits_paid_needs_amount
    check (cleaner_paid_at is null or cleaner_pay_cents is not null);

-- The weekly run asks one question: who is owed what. This is the index for it.
create index if not exists visits_unpaid_cleaner_idx
  on visits (assigned_cleaner_id, cleaner_paid_at)
  where assigned_cleaner_id is not null and cleaner_paid_at is null;
