import { getConfig } from "@/lib/config";

export const runtime = "nodejs";

export async function GET() {
  const cfg = getConfig();
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
      db: cfg.hasDb ? "supabase" : "memory",
      supabaseKeys: Boolean(cfg.SUPABASE_PUBLIC_KEY || cfg.SUPABASE_SECRET_KEY),
    },
  });
}
