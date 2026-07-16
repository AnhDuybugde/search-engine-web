import { config as loadEnv } from "dotenv";
import { defineConfig } from "drizzle-kit";
import path from "path";

// Prefer web/.env.local, then web/.env, then repo root .env
loadEnv({ path: path.resolve(__dirname, ".env.local") });
loadEnv({ path: path.resolve(__dirname, ".env") });
loadEnv({ path: path.resolve(__dirname, "../.env") });

function normalizeDatabaseUrl(url?: string) {
  if (!url) return "";
  return url.trim().replace(/:\[([^\]]+)\]@/, ":$1@");
}

export default defineConfig({
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: normalizeDatabaseUrl(process.env.DATABASE_URL),
  },
});
