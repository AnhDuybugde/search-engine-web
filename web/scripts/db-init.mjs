import { config } from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import postgres from "postgres";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

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

const sql = postgres(url, {
  prepare: false,
  ssl: "require",
  max: 1,
  connect_timeout: 20,
});

const initPath = path.join(root, "drizzle", "0000_init.sql");
const migratePath = path.join(root, "drizzle", "0001_search_sessions.sql");
const init = fs.readFileSync(initPath, "utf8");
const migrate = fs.existsSync(migratePath)
  ? fs.readFileSync(migratePath, "utf8")
  : "";

try {
  await sql.unsafe(init);
  if (migrate.trim()) {
    await sql.unsafe(migrate);
  }
  const tables = await sql`
    select table_name
    from information_schema.tables
    where table_schema = 'public'
      and table_name in (
        'notebooks', 'sources', 'chunks', 'search_runs',
        'search_sessions', 'search_messages'
      )
    order by table_name
  `;
  console.log(
    "Supabase schema ready:",
    tables.map((t) => t.table_name).join(", "),
  );
} catch (err) {
  console.error("db:init failed:", err instanceof Error ? err.message : err);
  process.exit(1);
} finally {
  await sql.end({ timeout: 5 });
}
