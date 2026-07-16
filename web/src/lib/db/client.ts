import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { getConfig } from "@/lib/config";
import * as schema from "./schema";
import { hasSupabaseRest } from "./supabase";

export type AppDb = PostgresJsDatabase<typeof schema>;

const globalForDb = globalThis as unknown as {
  __supabaseSql?: ReturnType<typeof postgres>;
  __supabaseDb?: AppDb;
};

/**
 * Direct Postgres via DATABASE_URL (optional fallback).
 * On Vercel prefer Supabase REST — see getSupabaseAdmin().
 * If using SQL, use Supabase **Transaction pooler** URI (port 6543).
 */
export function getDb(): AppDb {
  const cfg = getConfig();
  if (!cfg.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is not set. On Vercel prefer SUPABASE_URL + SUPABASE_SECRET_KEY, or set a pooler DATABASE_URL (port 6543).",
    );
  }

  if (!globalForDb.__supabaseDb) {
    // max:1 is safer for serverless + Supabase pooler
    const sql = postgres(cfg.DATABASE_URL, {
      prepare: false,
      max: 1,
      idle_timeout: 10,
      connect_timeout: 10,
      ssl: "require",
      connection: {
        application_name: "search-engine-web",
      },
    });
    globalForDb.__supabaseSql = sql;
    globalForDb.__supabaseDb = drizzle(sql, { schema });
  }

  return globalForDb.__supabaseDb;
}

export function hasDb() {
  return getConfig().hasDb;
}

export function dbBackend(): "supabase-rest" | "postgres" | "memory" {
  if (hasSupabaseRest()) return "supabase-rest";
  if (getConfig().DATABASE_URL) return "postgres";
  return "memory";
}
