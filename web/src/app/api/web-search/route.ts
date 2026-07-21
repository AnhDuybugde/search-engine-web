import { z } from "zod";
import { createSseResponse } from "@/lib/sse";
import { runWebSearchPipeline } from "@/lib/pipeline/web-search";
import { saveSearchRun } from "@/lib/db/runs-repo";
import { getConfig } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const bodySchema = z.object({
  query: z.string().min(1).max(2000),
  searchLimit: z.number().int().min(1).max(15).optional(),
  retrieveTopK: z.number().int().min(1).max(50).optional(),
  contextTopK: z.number().int().min(1).max(12).optional(),
  generateAnswer: z.boolean().optional(),
  enrichThinPages: z.boolean().optional(),
  saveHistory: z.boolean().optional().default(true),
  /** Per-request retrieval method; defaults to RETRIEVAL_MODE env. */
  retrievalMode: z.enum(["bm25", "adaptive_rrf", "sgaf"]).optional(),
});

export async function POST(req: Request) {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid request", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const cfg = getConfig();
  if (!cfg.hasSearch) {
    return Response.json(
      {
        error:
          "Search provider not configured. Set TAVILY_API_KEY (or BRAVE_API_KEY) in Vercel env.",
      },
      { status: 500 },
    );
  }

  const input = parsed.data;

  return createSseResponse(async (emit, { signal }) => {
    // Real search_started with query (sse.ts may emit empty first pulse)
    emit({ type: "search_started", query: input.query });

    const result = await runWebSearchPipeline({ ...input, signal }, emit);

    if (input.saveHistory !== false) {
      try {
        await saveSearchRun({
          query: input.query,
          results: result.results,
          answer: result.answer,
          timing: result.timing,
          metrics: result.metrics,
        });
      } catch (err) {
        console.error("[web-search history]", err);
      }
    }
  }, req);
}
