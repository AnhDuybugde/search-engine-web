import { dbSetupHint, getConfig } from "@/lib/config";
import { dbBackend, getDb } from "@/lib/db/client";
import { getSupabaseAdmin, sbError } from "@/lib/db/supabase";
import { sql } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const cfg = getConfig();
  const backend = dbBackend();

  let dbProbe: { ok: boolean; detail?: string } = {
    ok: backend === "memory",
    detail: backend === "memory" ? "In-memory (no durable DB)" : undefined,
  };

  if (backend === "supabase-rest") {
    try {
      const sb = getSupabaseAdmin()!;
      const { error } = await sb.from("notebooks").select("id").limit(1);
      if (error) {
        dbProbe = {
          ok: false,
          detail: `${sbError(error)}. If relation missing, run drizzle/0000_init.sql in Supabase SQL Editor.`,
        };
      } else {
        dbProbe = { ok: true, detail: "notebooks table reachable via REST" };
      }
    } catch (err) {
      dbProbe = {
        ok: false,
        detail: err instanceof Error ? err.message : "probe failed",
      };
    }
  } else if (backend === "postgres") {
    try {
      const db = getDb();
      await db.execute(sql`select 1`);
      // also check notebooks exists
      try {
        await db.execute(sql`select id from notebooks limit 1`);
        dbProbe = {
          ok: true,
          detail:
            "Postgres reachable. On Vercel still prefer SUPABASE_SECRET_KEY (REST) for stability.",
        };
      } catch (tableErr) {
        const m = tableErr instanceof Error ? tableErr.message : String(tableErr);
        dbProbe = {
          ok: false,
          detail: `Connected but notebooks query failed: ${m}. Run drizzle/0000_init.sql. ${dbSetupHint(cfg)}`,
        };
      }
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      dbProbe = {
        ok: false,
        detail: `Postgres connect/query failed: ${m}. ${dbSetupHint(cfg)}`,
      };
    }
  }

  const missing: string[] = [];
  if (!cfg.hasSearch) missing.push("TAVILY_API_KEY (or BRAVE_API_KEY)");
  if (!cfg.hasLlm) missing.push("LLM_API_KEY");
  if (!cfg.hasSupabaseRest) {
    if (!cfg.supabaseUrl) missing.push("SUPABASE_URL");
    if (!cfg.SUPABASE_SECRET_KEY) missing.push("SUPABASE_SECRET_KEY");
  }

  return Response.json({
    ok: true,
    mode: "serverless",
    providers: {
      search: cfg.hasSearch
        ? cfg.TAVILY_API_KEY
          ? "tavily"
          : "brave"
        : null,
      llm: cfg.hasLlm
        ? { baseUrl: cfg.LLM_BASE_URL, model: cfg.LLM_MODEL }
        : null,
      db: backend,
      supabaseUrl: cfg.supabaseUrl || null,
      hasSecretKey: Boolean(cfg.SUPABASE_SECRET_KEY),
      hasDatabaseUrl: Boolean(cfg.DATABASE_URL),
      onVercel: cfg.onVercel,
      dbProbe,
      missing,
      hint: dbSetupHint(cfg),
    },
  });
}
