/**
 * Ensure chat-history schema exists on the SQL backend (DATABASE_URL).
 * Live Supabase REST cannot run DDL; when REST lacks tables but DATABASE_URL
 * is available, repos fall back to Drizzle after this ensure.
 *
 * Connection failures are cached briefly so a dead DATABASE_URL does not add
 * multi-second latency to every notebook-ask / session history call.
 */
import { readFileSync, existsSync } from "fs";
import path from "path";
import postgres from "postgres";
import { getConfig, normalizeDatabaseUrl } from "@/lib/config";

let ensurePromise: Promise<boolean> | null = null;
let lastEnsureOk: boolean | null = null;
/** Epoch ms when a failed ensure may be retried (connection flaps, docker start). */
let failRetryAfterMs = 0;
/** Negative-cache window after ECONNREFUSED / timeout. */
const FAIL_CACHE_MS = 30_000;

const CHAT_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(36) PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS users_email_idx ON users (email);

ALTER TABLE search_sessions
  ADD COLUMN IF NOT EXISTS user_id varchar(36);

CREATE INDEX IF NOT EXISTS search_sessions_user_updated_idx
  ON search_sessions (user_id, updated_at DESC);

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
`;

function resolveDatabaseUrl(): string | undefined {
  const cfg = getConfig();
  return normalizeDatabaseUrl(cfg.DATABASE_URL || process.env.DATABASE_URL);
}

function isLocalUrl(url: string): boolean {
  return (
    /@(localhost|127\.0\.0\.1|\[::1\])[:/]/i.test(url) ||
    process.env.DB_SSL === "disable"
  );
}

/**
 * True only after a successful ensure in this process.
 * Use before calling getDb() for chat-history so a dead DATABASE_URL is skipped.
 */
export function isSqlChatHistoryReady(): boolean {
  return lastEnsureOk === true;
}

/**
 * Prefer SQL chat-history when DATABASE_URL is set and ensure succeeds.
 * Returns false quickly when URL missing or last ensure failed within cache window.
 */
export async function preferSqlChatHistory(): Promise<boolean> {
  if (!resolveDatabaseUrl()) return false;
  if (lastEnsureOk === true) return true;
  if (lastEnsureOk === false && Date.now() < failRetryAfterMs) return false;
  return ensureChatHistorySqlSchema();
}

/** Apply chat-history DDL via DATABASE_URL. Returns true if SQL path is usable. */
export async function ensureChatHistorySqlSchema(): Promise<boolean> {
  if (lastEnsureOk === true) return true;
  if (lastEnsureOk === false && Date.now() < failRetryAfterMs) {
    return false;
  }
  if (ensurePromise) return ensurePromise;

  ensurePromise = (async () => {
    const url = resolveDatabaseUrl();
    if (!url) {
      lastEnsureOk = false;
      failRetryAfterMs = Date.now() + FAIL_CACHE_MS;
      return false;
    }
    const connectTimeout = isLocalUrl(url) ? 3 : 8;
    const sql = postgres(url, {
      prepare: false,
      max: 1,
      connect_timeout: connectTimeout,
      ssl: isLocalUrl(url) ? false : "require",
    });
    try {
      // Prefer committed migration files when present
      const drizzleDir = path.join(process.cwd(), "drizzle");
      const files = ["0003_users.sql", "0004_chat_history_owners.sql"];
      for (const name of files) {
        const p = path.join(drizzleDir, name);
        if (existsSync(p)) {
          const body = readFileSync(p, "utf8");
          if (body.trim()) await sql.unsafe(body);
        }
      }
      // Always re-apply idempotent CHAT_SQL for environments that only got partial files
      await sql.unsafe(CHAT_SQL);

      const tables = await sql`
        select table_name
        from information_schema.tables
        where table_schema = 'public'
          and table_name in ('users', 'notebook_messages', 'search_sessions')
      `;
      const names = new Set(tables.map((t) => t.table_name as string));
      const cols = await sql`
        select column_name
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'search_sessions'
          and column_name = 'user_id'
      `;
      const ok =
        names.has("notebook_messages") &&
        names.has("search_sessions") &&
        cols.length > 0;
      lastEnsureOk = ok;
      if (!ok) failRetryAfterMs = Date.now() + FAIL_CACHE_MS;
      return ok;
    } catch (err) {
      console.error(
        "[ensureChatHistorySqlSchema]",
        err instanceof Error ? err.message : err,
      );
      lastEnsureOk = false;
      failRetryAfterMs = Date.now() + FAIL_CACHE_MS;
      return false;
    } finally {
      try {
        await sql.end({ timeout: 3 });
      } catch {
        /* ignore */
      }
    }
  })();

  try {
    return await ensurePromise;
  } finally {
    // Drop in-flight promise after settle so success path stays cached via lastEnsureOk
    // and failure path can re-enter only after failRetryAfterMs.
    ensurePromise = null;
  }
}

export function hasSqlDatabaseUrl(): boolean {
  return Boolean(resolveDatabaseUrl());
}

/** Reset cached ensure result (tests). */
export function resetChatHistorySchemaCache(): void {
  ensurePromise = null;
  lastEnsureOk = null;
  failRetryAfterMs = 0;
}
