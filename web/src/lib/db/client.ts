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
    const local =
      /@(localhost|127\.0\.0\.1|\[::1\])[:/]/i.test(cfg.DATABASE_URL) ||
      process.env.DB_SSL === "disable";
    const sql = postgres(cfg.DATABASE_URL, {
      prepare: false,
      max: 1,
      idle_timeout: 10,
      connect_timeout: 10,
      ssl: local ? false : "require",
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

/**
 * Ephemeral in-memory store is only allowed when:
 * - ALLOW_MEMORY_DB=1 (explicit demo/dev override), or
 * - not production and not Vercel (local open development).
 */
export function isMemoryDbAllowed(): boolean {
  if (process.env.ALLOW_MEMORY_DB === "1") return true;
  const onVercel =
    process.env.VERCEL === "1" || Boolean(process.env.VERCEL_ENV);
  const prod = process.env.NODE_ENV === "production";
  return !onVercel && !prod;
}

export class DurableDbRequiredError extends Error {
  readonly status = 503;
  constructor(action: string) {
    super(
      `${action} requires a durable database (SUPABASE_URL + SUPABASE_SECRET_KEY, or DATABASE_URL). ` +
        `Set ALLOW_MEMORY_DB=1 only for intentional ephemeral demos. ${dbSetupHint()}`,
    );
    this.name = "DurableDbRequiredError";
  }
}

/**
 * Fail-closed for product write/read paths on Vercel/production when no durable DB.
 * No-op when hasDb() or memory is explicitly allowed.
 */
export function assertDurableDb(action: string): void {
  if (hasDb()) return;
  if (isMemoryDbAllowed()) return;
  throw new DurableDbRequiredError(action);
}

/** HTTP gate for API routes (503 JSON, no secret leakage). */
export function requireDurableDb(action = "This API"): Response | null {
  if (hasDb() || isMemoryDbAllowed()) return null;
  return Response.json(
    {
      error:
        `${action} requires a durable database. ` +
        `Configure SUPABASE_URL + SUPABASE_SECRET_KEY (or DATABASE_URL), ` +
        `or set ALLOW_MEMORY_DB=1 for ephemeral demos only.`,
    },
    { status: 503, headers: { "Cache-Control": "no-store" } },
  );
}

/** Wrap low-level DB errors with setup guidance for Vercel. */
export function enrichDbError(err: unknown, action: string): Error {
  if (err instanceof DurableDbRequiredError) return err;
  const msg = err instanceof Error ? err.message : String(err);
  const backend = dbBackend();
  const hint = dbSetupHint();
  return new Error(`${action} failed via ${backend}: ${msg}. ${hint}`);
}
