CREATE TABLE IF NOT EXISTS search_sessions (
  id varchar(36) PRIMARY KEY,
  title text NOT NULL DEFAULT 'New chat',
  summary text,
  entities_json jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS search_messages (
  id varchar(36) PRIMARY KEY,
  session_id varchar(36) NOT NULL,
  role varchar(16) NOT NULL,
  content text NOT NULL,
  expanded_query text,
  results_json jsonb,
  timing_json jsonb,
  metrics_json jsonb,
  status varchar(32) NOT NULL DEFAULT 'completed',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS search_sessions_updated_idx
  ON search_sessions (updated_at DESC);

CREATE INDEX IF NOT EXISTS search_messages_session_idx
  ON search_messages (session_id, created_at ASC);
