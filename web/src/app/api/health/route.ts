import { dbSetupHint, getConfig } from "@/lib/config";
import { dbBackend, getDb, isMemoryDbAllowed } from "@/lib/db/client";
import { getSupabaseAdmin, sbError } from "@/lib/db/supabase";
import { sql } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Public body is intentionally minimal (no provider names, URLs, models, env hints).
 * Full diagnostics: Authorization: Bearer <HEALTH_SECRET|APP_PASSWORD>
 *   or ?token=<same>
 */
function isAuthorized(req: Request): boolean {
  const cfg = getConfig();
  const secret =
    process.env.HEALTH_SECRET?.trim() ||
    cfg.APP_PASSWORD?.trim() ||
    "";
  // No secret configured → only public summary (never dump internals on the internet)
  if (!secret) return false;

  const auth = req.headers.get("authorization") || "";
  const bearer = auth.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  const url = new URL(req.url);
  const token = url.searchParams.get("token")?.trim();

  return bearer === secret || token === secret;
}

async function probeDb(backend: ReturnType<typeof dbBackend>) {
  const cfg = getConfig();
  let dbProbe: { ok: boolean; detail?: string } = {
    ok: backend === "memory",
    detail: backend === "memory" ? "In-memory (no durable DB)" : undefined,
  };

  if (backend === "supabase-rest") {
    try {
      const sb = getSupabaseAdmin()!;
      const notebooks = await sb.from("notebooks").select("id").limit(1);
      if (notebooks.error) {
        dbProbe = {
          ok: false,
          detail: `${sbError(notebooks.error)}. If relation missing, run drizzle SQL in Supabase SQL Editor.`,
        };
      } else {
        const sessions = await sb.from("search_sessions").select("id").limit(1);
        if (sessions.error) {
          dbProbe = {
            ok: false,
            detail: `notebooks OK but search_sessions failed: ${sbError(sessions.error)}`,
          };
        } else {
          // Best-effort embedding column presence (non-fatal if missing — app has fallback).
          const chunks = await sb
            .from("chunks")
            .select("id,embedding_json,embedding_model")
            .limit(1);
          if (chunks.error) {
            const msg = sbError(chunks.error);
            const missingEmb =
              msg.includes("embedding") ||
              msg.includes("PGRST204") ||
              msg.includes("42703");
            dbProbe = {
              ok: true,
              detail: missingEmb
                ? "tables reachable; chunks embedding columns missing — run drizzle/0002_chunk_embeddings.sql"
                : `tables reachable; chunks probe: ${msg}`,
            };
          } else {
            dbProbe = {
              ok: true,
              detail: "notebooks + search_sessions + chunks (with embeddings) reachable via REST",
            };
          }
        }
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
      try {
        await db.execute(sql`select id from notebooks limit 1`);
        await db.execute(sql`select id from search_sessions limit 1`);
        dbProbe = {
          ok: true,
          detail:
            "Postgres reachable. On Vercel still prefer SUPABASE_SECRET_KEY (REST) for stability.",
        };
      } catch (tableErr) {
        const m = tableErr instanceof Error ? tableErr.message : String(tableErr);
        dbProbe = {
          ok: false,
          detail: `Connected but table query failed: ${m}. Run drizzle migrations. ${dbSetupHint(cfg)}`,
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

  return dbProbe;
}

export async function GET(req: Request) {
  const cfg = getConfig();
  const backend = dbBackend();
  const authorized = isAuthorized(req);

  const status = {
    search: cfg.hasSearch,
    llm: cfg.hasLlm,
    embedding: cfg.RETRIEVAL_MODE === "bm25" || cfg.hasEmbedding,
    db: cfg.hasDb && (backend === "supabase-rest" || backend === "postgres"),
  };

  // Product readiness: search + LLM + durable DB (embedding optional when bm25).
  // Public ok=false → HTTP 503 so load balancers can fail the instance.
  const ok = Boolean(status.search && status.llm && status.db && status.embedding);

  const publicBody = {
    ok,
    status,
  };

  if (!authorized) {
    return Response.json(publicBody, {
      status: ok ? 200 : 503,
      headers: {
        "Cache-Control": "no-store",
      },
    });
  }

  const dbProbe = await probeDb(backend);
  const ready = ok && (backend === "memory" ? false : dbProbe.ok);

  const missing: string[] = [];
  if (!cfg.hasSearch) missing.push("TAVILY_API_KEY (or BRAVE_API_KEY)");
  if (!cfg.hasLlm) missing.push("LLM_API_KEY");
  if (cfg.RETRIEVAL_MODE !== "bm25" && !cfg.hasEmbedding) {
    missing.push("EMBEDDING_API_URL (or Hugging Face EMBEDDING_API_KEY)");
  }
  if (!cfg.hasSupabaseRest) {
    if (!cfg.supabaseUrl) missing.push("SUPABASE_URL");
    if (!cfg.SUPABASE_SECRET_KEY) missing.push("SUPABASE_SECRET_KEY");
  }
  if (!cfg.hasDb && !isMemoryDbAllowed()) {
    missing.push("durable DB (SUPABASE_URL+SUPABASE_SECRET_KEY or DATABASE_URL)");
  }

  return Response.json(
    {
      ...publicBody,
      ok: ready,
      mode: "serverless",
      diagnostics: true,
      providers: {
        search: cfg.hasSearch
          ? cfg.TAVILY_API_KEY
            ? "tavily"
            : "brave"
          : null,
        llm: cfg.hasLlm
          ? { baseUrl: cfg.LLM_BASE_URL, model: cfg.LLM_MODEL }
          : null,
        retrieval: {
          mode: cfg.RETRIEVAL_MODE,
          embeddingConfigured: cfg.hasEmbedding,
          embeddingProvider: cfg.EMBEDDING_PROVIDER,
          embeddingModel: cfg.EMBEDDING_MODEL,
        },
        db: backend,
        // host only — never include keys
        supabaseHost: cfg.supabaseUrl
          ? (() => {
              try {
                return new URL(cfg.supabaseUrl).host;
              } catch {
                return "invalid-url";
              }
            })()
          : null,
        hasSecretKey: Boolean(cfg.SUPABASE_SECRET_KEY),
        hasDatabaseUrl: Boolean(cfg.DATABASE_URL),
        onVercel: cfg.onVercel,
        dbProbe,
        missing,
        hint: dbSetupHint(cfg),
      },
    },
    {
      status: ready ? 200 : 503,
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
