import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { getConfig } from "@/lib/config";
import * as schema from "./schema";

export type AppDb = PostgresJsDatabase<typeof schema>;

const globalForDb = globalThis as unknown as {
  __supabaseSql?: ReturnType<typeof postgres>;
  __supabaseDb?: AppDb;
};

/**
 * Supabase is standard Postgres. Use postgres.js (not Neon HTTP driver).
 * `prepare: false` is required for Supabase transaction pooler (port 6543).
 */
export function getDb(): AppDb {
  const cfg = getConfig();
  if (!cfg.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is not set. Use your Supabase Postgres connection string.",
    );
  }

  if (!globalForDb.__supabaseDb) {
    const sql = postgres(cfg.DATABASE_URL, {
      prepare: false,
      max: 5,
      idle_timeout: 20,
      connect_timeout: 15,
      ssl: "require",
    });
    globalForDb.__supabaseSql = sql;
    globalForDb.__supabaseDb = drizzle(sql, { schema });
  }

  return globalForDb.__supabaseDb;
}

export function hasDb() {
  return getConfig().hasDb;
}
