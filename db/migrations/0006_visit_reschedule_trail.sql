-- Remember that a cleaning moved, and where it moved from.
--
-- The schedule shows when a visit is, never that it used to be somewhere else.
-- So a cleaner who was told Tuesday and an owner looking at Thursday had no
-- way to see they were talking about the same job, and no way to tell whether
-- the customer moved it or somebody mis-read the board.
--
-- Two columns rather than a full history table. The question being asked is
-- "did this move, and from when", which the latest move answers. A visit that
-- moves twice keeps only its most recent origin, which is what somebody
-- looking at today's list actually needs.

alter table visits
  add column rescheduled_at   timestamptz,
  add column rescheduled_from timestamptz;

comment on column visits.rescheduled_at is
  'When this visit was last moved. Null means it has never moved.';
comment on column visits.rescheduled_from is
  'The scheduled_for value immediately before the most recent move.';

-- The schedule and history screens both ask "what moved recently", so the
-- index is on the timestamp and only covers rows that have actually moved.
create index on visits (rescheduled_at desc) where rescheduled_at is not null;
