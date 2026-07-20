import { config } from "dotenv";
import dns from "dns";
import path from "path";
import { fileURLToPath } from "url";
import { promisify } from "util";
import postgres from "postgres";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
config({ path: path.join(root, ".env.local") });
config({ path: path.join(root, ".env") });

const lookup = promisify(dns.lookup);

const DDL = `
CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(36) PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS users_email_idx ON users (email);
`;

function parseUrl(url) {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: Number(u.port || 5432),
    database: u.pathname.replace(/^\//, "") || "postgres",
    username: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
  };
}

async function main() {
  const raw = (process.env.DATABASE_URL || "").trim();
  if (!raw) {
    console.error("DATABASE_URL missing");
    process.exit(1);
  }

  const parsed = parseUrl(raw);
  let hostaddr = parsed.host;
  try {
    const a = await lookup(parsed.host, { family: 4 });
    hostaddr = a.address;
    console.log(`Using IPv4 ${hostaddr} for ${parsed.host}`);
  } catch (e) {
    console.log(`IPv4 lookup failed (${e.message}), trying hostname as-is`);
  }

  const sql = postgres({
    host: hostaddr,
    port: parsed.port,
    database: parsed.database,
    username: parsed.username,
    password: parsed.password,
    ssl: { rejectUnauthorized: false },
    prepare: false,
    max: 1,
    connect_timeout: 20,
  });

  try {
    await sql.unsafe(DDL);
    const rows = await sql`select count(*)::int as n from users`;
    console.log("users table ready, row count =", rows[0].n);
  } finally {
    await sql.end({ timeout: 2 });
  }
}

main().catch((err) => {
  console.error("ensure-users-table failed:", err.message);
  process.exit(1);
});
