-- Add per-member calendar color (run if `group_members` has no `color` yet).

ALTER TABLE group_members
  ADD COLUMN IF NOT EXISTS color text NOT NULL DEFAULT '#6366f1';

-- If you previously stored color on `groups` and need to copy it into memberships:
-- UPDATE group_members AS gm SET color = g.color FROM groups AS g WHERE g.id = gm.group_id;
-- Then optional: ALTER TABLE groups DROP COLUMN IF EXISTS color;
