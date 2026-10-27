-- 002 — proposed actions live in the database, not in process memory.
--
-- The minutes generator returns proposed actions that are not yet real actions:
-- they become rows only when the minutes are signed. They must survive a restart
-- and be visible to any instance, so they belong on the meeting row.
BEGIN;

ALTER TABLE meetings
  ADD COLUMN IF NOT EXISTS proposed_actions jsonb NOT NULL DEFAULT '[]'::jsonb;

-- The migration runner records applied files in `_migrations`; this file must not
-- insert its own row, or the runner's insert collides on the second run.

COMMIT;
