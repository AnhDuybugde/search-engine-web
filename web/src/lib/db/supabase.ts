import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getConfig } from "@/lib/config";

const globalForSb = globalThis as unknown as {
  __supabaseAdmin?: SupabaseClient;
  __supabaseAdminKey?: string;
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

  const cacheKey = `${cfg.supabaseUrl}::${cfg.SUPABASE_SECRET_KEY.slice(0, 12)}`;
  if (
    !globalForSb.__supabaseAdmin ||
    globalForSb.__supabaseAdminKey !== cacheKey
  ) {
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
    globalForSb.__supabaseAdminKey = cacheKey;
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

export function sbError(
  err: { message?: string; code?: string; details?: string; hint?: string } | null,
) {
  if (!err) return "Unknown Supabase error";
  return [err.message, err.code, err.details, err.hint].filter(Boolean).join(" | ");
}
