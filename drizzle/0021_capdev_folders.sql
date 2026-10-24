CREATE TABLE IF NOT EXISTS capdev_folders (
  id serial PRIMARY KEY,
  name varchar(255) NOT NULL,
  created_at timestamp NOT NULL DEFAULT now()
);
ALTER TABLE capdevs ADD COLUMN IF NOT EXISTS folder_id integer REFERENCES capdev_folders(id) ON DELETE RESTRICT;
INSERT INTO capdev_folders (name)
SELECT 'Existing CapDev'
WHERE EXISTS (SELECT 1 FROM capdevs WHERE folder_id IS NULL)
  AND NOT EXISTS (SELECT 1 FROM capdev_folders WHERE name = 'Existing CapDev');
UPDATE capdevs SET folder_id = (SELECT id FROM capdev_folders WHERE name = 'Existing CapDev' ORDER BY id LIMIT 1)
WHERE folder_id IS NULL;
ALTER TABLE capdevs ALTER COLUMN folder_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS capdevs_folder_idx ON capdevs(folder_id);
