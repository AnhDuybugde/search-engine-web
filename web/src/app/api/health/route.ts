import { getConfig } from "@/lib/config";
import { dbBackend } from "@/lib/db/client";
import { getSupabaseAdmin } from "@/lib/db/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const cfg = getConfig();
  const backend = dbBackend();

  let dbProbe: { ok: boolean; detail?: string } = { ok: backend === "memory" };

  if (backend === "supabase-rest") {
    try {
      const sb = getSupabaseAdmin()!;
      const { error } = await sb.from("notebooks").select("id").limit(1);
      if (error) {
        dbProbe = {
          ok: false,
          detail: `${error.message}${error.code ? ` (${error.code})` : ""}. If relation missing, run drizzle/0000_init.sql in Supabase SQL Editor.`,
        };
      } else {
        dbProbe = { ok: true, detail: "notebooks table reachable" };
      }
    } catch (err) {
      dbProbe = {
        ok: false,
        detail: err instanceof Error ? err.message : "probe failed",
      };
    }
  } else if (backend === "postgres") {
    dbProbe = {
      ok: true,
      detail: "Using DATABASE_URL SQL (prefer pooler :6543 on Vercel)",
    };
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
      dbProbe,
    },
  });
}
