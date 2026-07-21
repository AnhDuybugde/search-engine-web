-- Dataset lock + index status (prevent accidental delete; surface embed progress)
ALTER TABLE notebooks
  ADD COLUMN IF NOT EXISTS locked boolean NOT NULL DEFAULT false;

ALTER TABLE notebooks
  ADD COLUMN IF NOT EXISTS index_status text NOT NULL DEFAULT 'none';

ALTER TABLE notebooks
  ADD COLUMN IF NOT EXISTS index_message text;

ALTER TABLE notebooks
  ADD COLUMN IF NOT EXISTS unit_count integer NOT NULL DEFAULT 0;

ALTER TABLE notebooks
  ADD COLUMN IF NOT EXISTS embedded_count integer NOT NULL DEFAULT 0;

ALTER TABLE notebooks
  ADD COLUMN IF NOT EXISTS indexed_at timestamptz;

-- Protect demo corpora by default (user can unlock)
UPDATE notebooks
SET locked = true
WHERE title IN (
  'SCIFACT (raw)',
  'SCIDOCS (raw)',
  'SCIFACT Demo (raw)',
  'SCIDOCS Demo (raw)'
);
