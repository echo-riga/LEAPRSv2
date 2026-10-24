ALTER TABLE capdev_folders ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT false;
UPDATE capdev_folders SET is_active = true
WHERE id = (SELECT id FROM capdev_folders ORDER BY id LIMIT 1)
  AND NOT EXISTS (SELECT 1 FROM capdev_folders WHERE is_active = true);
CREATE UNIQUE INDEX IF NOT EXISTS capdev_folders_one_active_idx ON capdev_folders(is_active) WHERE is_active = true;
