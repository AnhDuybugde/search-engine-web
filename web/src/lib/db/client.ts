import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { dbSetupHint, getConfig } from "@/lib/config";
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
      "DATABASE_URL is not set. On Vercel set SUPABASE_URL + SUPABASE_SECRET_KEY (recommended), or a pooler DATABASE_URL (port 6543).",
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

/** Wrap low-level DB errors with setup guidance for Vercel. */
export function enrichDbError(err: unknown, action: string): Error {
  const msg = err instanceof Error ? err.message : String(err);
  const backend = dbBackend();
  const hint = dbSetupHint();
  return new Error(`${action} failed via ${backend}: ${msg}. ${hint}`);
}
