ALTER TABLE chunks
  ADD COLUMN IF NOT EXISTS embedding_json jsonb,
  ADD COLUMN IF NOT EXISTS embedding_model text;
