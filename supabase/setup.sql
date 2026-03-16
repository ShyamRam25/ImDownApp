-- ============================================================
-- ImDown — Full Supabase Setup
-- Run this entire file in the Supabase SQL Editor once the
-- project is unpaused. It is idempotent for the ALTER statements
-- but CREATE TABLE will fail if tables already exist.
-- ============================================================

-- 1. Update the existing users table -------------------------

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS created_at  timestamptz DEFAULT now();

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS google_id   text UNIQUE;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS email       text;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS avatar_url  text;

ALTER TABLE users
  ALTER COLUMN password DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_username_unique'
  ) THEN
    ALTER TABLE users ADD CONSTRAINT users_username_unique UNIQUE (username);
  END IF;
END $$;

-- 2. Groups --------------------------------------------------

CREATE TABLE IF NOT EXISTS groups (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);

-- 3. Group members -------------------------------------------

CREATE TABLE IF NOT EXISTS group_members (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id  uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role      text NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  joined_at timestamptz DEFAULT now(),
  UNIQUE (group_id, user_id)
);

-- 4. Events --------------------------------------------------

CREATE TABLE IF NOT EXISTS events (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title      text NOT NULL,
  location   text DEFAULT '',
  details    text DEFAULT '',
  start_time timestamptz NOT NULL,
  end_time   timestamptz NOT NULL,
  created_at timestamptz DEFAULT now(),
  CHECK (end_time > start_time)
);

-- 5. Event ↔ Group junction ----------------------------------

CREATE TABLE IF NOT EXISTS event_groups (
  id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  group_id uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  UNIQUE (event_id, group_id)
);

-- 6. RSVPs ---------------------------------------------------

CREATE TABLE IF NOT EXISTS event_rsvps (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id     uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status       text NOT NULL CHECK (status IN ('going', 'maybe', 'notgoing')),
  responded_at timestamptz DEFAULT now(),
  UNIQUE (event_id, user_id)
);

-- 7. Indexes -------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_group_members_user   ON group_members(user_id);
CREATE INDEX IF NOT EXISTS idx_group_members_group  ON group_members(group_id);
CREATE INDEX IF NOT EXISTS idx_event_groups_event   ON event_groups(event_id);
CREATE INDEX IF NOT EXISTS idx_event_groups_group   ON event_groups(group_id);
CREATE INDEX IF NOT EXISTS idx_events_created_by    ON events(created_by);
CREATE INDEX IF NOT EXISTS idx_events_time_range    ON events(start_time, end_time);
CREATE INDEX IF NOT EXISTS idx_event_rsvps_event    ON event_rsvps(event_id);
CREATE INDEX IF NOT EXISTS idx_event_rsvps_user     ON event_rsvps(user_id);

-- 8. Seed default groups -------------------------------------

INSERT INTO groups (name)
SELECT name FROM (VALUES
  ('CSCW classmates'),
  ('soccer teammates'),
  ('capstone group'),
  ('home town friends')
) AS seed(name)
WHERE NOT EXISTS (SELECT 1 FROM groups WHERE groups.name = seed.name);
