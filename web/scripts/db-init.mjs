import { config } from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import postgres from "postgres";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

// Load env files without clobbering explicitly-provided process env.
config({ path: path.join(root, ".env.local") });
config({ path: path.join(root, ".env") });
config({ path: path.join(root, "../.env") });

function normalizeDatabaseUrl(url) {
  if (!url) return "";
  return url.trim().replace(/:\[([^\]]+)\]@/, ":$1@");
}

const url = normalizeDatabaseUrl(process.env.DATABASE_URL);
if (!url) {
  console.error("DATABASE_URL is missing. Set it in web/.env.local");
  process.exit(1);
}

const isLocal =
  /@(localhost|127\.0\.0\.1|\[::1\])[:/]/i.test(url) ||
  process.env.DB_SSL === "disable";

const sql = postgres(url, {
  prepare: false,
  ssl: isLocal ? false : "require",
  max: 1,
  connect_timeout: 20,
});

const drizzleDir = path.join(root, "drizzle");
const migrations = fs
  .readdirSync(drizzleDir)
  .filter((name) => /^\d+.*\.sql$/i.test(name))
  .sort()
  .map((name) => ({
    name,
    sql: fs.readFileSync(path.join(drizzleDir, name), "utf8"),
  }));

const REQUIRED_COLUMNS = {
  users: [
    "id",
    "email",
    "password_hash",
    "display_name",
    "created_at",
    "updated_at",
  ],
  notebooks: ["id", "title", "created_at", "updated_at"],
  sources: ["id", "notebook_id", "title", "mime", "text", "blob_url", "created_at"],
  chunks: [
    "id",
    "source_id",
    "notebook_id",
    "chunk_index",
    "text",
    "token_est",
    "embedding_json",
    "embedding_model",
  ],
  search_runs: [
    "id",
    "query",
    "status",
    "results_json",
    "answer",
    "timing_json",
    "metrics_json",
    "created_at",
    "completed_at",
  ],
  search_sessions: [
    "id",
    "user_id",
    "title",
    "summary",
    "entities_json",
    "created_at",
    "updated_at",
  ],
  search_messages: [
    "id",
    "session_id",
    "role",
    "content",
    "expanded_query",
    "results_json",
    "timing_json",
    "metrics_json",
    "status",
    "created_at",
  ],
  notebook_messages: [
    "id",
    "notebook_id",
    "user_id",
    "role",
    "content",
    "results_json",
    "timing_json",
    "metrics_json",
    "documents_json",
    "status",
    "created_at",
  ],
  notebook_uploads: [
    "id",
    "notebook_id",
    "storage_bucket",
    "storage_path",
    "original_filename",
    "safe_filename",
    "mime",
    "byte_size",
    "status",
    "stage",
    "progress",
    "created_at",
    "updated_at",
  ],
};

try {
  for (const migration of migrations) {
    console.log(`Applying ${migration.name}…`);
    if (migration.sql.trim()) {
      await sql.unsafe(migration.sql);
    }
  }

  const tables = await sql`
    select table_name
    from information_schema.tables
    where table_schema = 'public'
      and table_name in (
        'notebooks', 'sources', 'chunks', 'search_runs',
        'search_sessions', 'search_messages', 'notebook_messages'
        , 'notebook_uploads'
      )
    order by table_name
  `;
  const tableNames = tables.map((t) => t.table_name);
  console.log("Tables:", tableNames.join(", "));

  const missingTables = Object.keys(REQUIRED_COLUMNS).filter(
    (t) => !tableNames.includes(t),
  );
  if (missingTables.length) {
    throw new Error(`Missing tables: ${missingTables.join(", ")}`);
  }

  const cols = await sql`
    select table_name, column_name
    from information_schema.columns
    where table_schema = 'public'
      and table_name = any(${Object.keys(REQUIRED_COLUMNS)})
  `;
  const byTable = new Map();
  for (const row of cols) {
    if (!byTable.has(row.table_name)) byTable.set(row.table_name, new Set());
    byTable.get(row.table_name).add(row.column_name);
  }

  const missingCols = [];
  for (const [table, required] of Object.entries(REQUIRED_COLUMNS)) {
    const have = byTable.get(table) || new Set();
    for (const col of required) {
      if (!have.has(col)) missingCols.push(`${table}.${col}`);
    }
  }
  if (missingCols.length) {
    throw new Error(
      `Missing columns after migrations: ${missingCols.join(", ")}. ` +
        `Ensure drizzle/0002_chunk_embeddings.sql was applied.`,
    );
  }

  console.log(
    "Supabase schema ready (column check OK, including chunks.embedding_json/model):",
    tableNames.join(", "),
  );
} catch (err) {
  console.error("db:init failed:", err instanceof Error ? err.message : err);
  process.exit(1);
} finally {
  await sql.end({ timeout: 5 });
}
