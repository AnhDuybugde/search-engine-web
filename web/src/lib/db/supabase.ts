import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getConfig } from "@/lib/config";

const globalForSb = globalThis as unknown as {
  __supabaseAdmin?: SupabaseClient;
};

/**
 * Supabase REST client (service / secret key).
 * Preferred on Vercel — avoids flaky direct Postgres connections from serverless.
 */
export function getSupabaseAdmin(): SupabaseClient | null {
  const cfg = getConfig();
  if (!cfg.supabaseUrl || !cfg.SUPABASE_SECRET_KEY) {
    return null;
  }

  if (!globalForSb.__supabaseAdmin) {
    globalForSb.__supabaseAdmin = createClient(
      cfg.supabaseUrl,
      cfg.SUPABASE_SECRET_KEY,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      },
    );
  }
  return globalForSb.__supabaseAdmin;
}

export function hasSupabaseRest() {
  return Boolean(getSupabaseAdmin());
}

export function toIso(value: unknown, fallback = new Date().toISOString()) {
  if (!value) return fallback;
  if (typeof value === "string") return value;
  if (value instanceof Date) return value.toISOString();
  return fallback;
}
