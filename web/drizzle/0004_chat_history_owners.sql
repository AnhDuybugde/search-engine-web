-- Web Search: own sessions per user account
ALTER TABLE search_sessions
  ADD COLUMN IF NOT EXISTS user_id varchar(36);

CREATE INDEX IF NOT EXISTS search_sessions_user_updated_idx
  ON search_sessions (user_id, updated_at DESC);

-- Dataset notebook chat history (per user + notebook)
CREATE TABLE IF NOT EXISTS notebook_messages (
  id varchar(36) PRIMARY KEY,
  notebook_id varchar(36) NOT NULL,
  user_id varchar(36) NOT NULL,
  role varchar(16) NOT NULL,
  content text NOT NULL,
  results_json jsonb,
  timing_json jsonb,
  metrics_json jsonb,
  documents_json jsonb,
  status varchar(32) NOT NULL DEFAULT 'completed',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notebook_messages_notebook_user_idx
  ON notebook_messages (notebook_id, user_id, created_at ASC);
