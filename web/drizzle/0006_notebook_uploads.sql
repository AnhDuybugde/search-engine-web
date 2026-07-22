CREATE TABLE IF NOT EXISTS notebook_uploads (
  id varchar(36) PRIMARY KEY,
  notebook_id varchar(36) NOT NULL,
  storage_bucket text NOT NULL,
  storage_path text NOT NULL,
  original_filename text NOT NULL,
  safe_filename text NOT NULL,
  mime text,
  byte_size integer NOT NULL,
  checksum text,
  status text NOT NULL DEFAULT 'pending',
  stage text NOT NULL DEFAULT 'created',
  progress integer NOT NULL DEFAULT 0,
  source_id varchar(36),
  error_message text,
  retry_count integer NOT NULL DEFAULT 0,
  idempotency_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS notebook_uploads_status_idx
  ON notebook_uploads(status, updated_at);

CREATE INDEX IF NOT EXISTS notebook_uploads_notebook_idx
  ON notebook_uploads(notebook_id);

CREATE UNIQUE INDEX IF NOT EXISTS notebook_uploads_idempotency_idx
  ON notebook_uploads(notebook_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
