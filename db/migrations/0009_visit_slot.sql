-- Which of a period's two cleanings this is.
--
-- Members can set a different weekday for each of their two monthly cleanings,
-- and the remembered day is written back to whichever one they moved. Until
-- now "which one" was worked out by counting how many visits in the period
-- fell earlier, which is only correct while the two stay in order.
--
-- Move the second cleaning to before the first and they swap. The next move
-- then writes to the wrong preference, and a member who asked for Thursday and
-- Saturday ends up remembered as Tuesday and Thursday, with future months
-- following the wrong one.
--
-- The slot is a property of the visit, not of its current date, so it is
-- stored rather than derived.

alter table visits add column slot smallint check (slot >= 0);

comment on column visits.slot is
  'Which cleaning of the period this is: 0 for the first, 1 for the second. '
  'Null for one-off visits, which do not belong to a period.';

-- Backfill from the order they currently sit in, which is right for every
-- existing row because nothing has been reordered by a move yet.
update visits v
   set slot = ordered.rn - 1
  from (
    select id,
           row_number() over (
             partition by period_id order by scheduled_for, created_at
           ) as rn
      from visits
     where period_id is not null
       and status <> 'canceled'
  ) as ordered
 where v.id = ordered.id;

-- Realignment looks up one slot within one period, repeatedly.
create index on visits (period_id, slot) where period_id is not null;
