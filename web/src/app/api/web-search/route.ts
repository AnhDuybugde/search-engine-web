import { z } from "zod";
import { createSseResponse } from "@/lib/sse";
import { runWebSearchPipeline } from "@/lib/pipeline/web-search";
import { saveSearchRun } from "@/lib/db/runs-repo";

export const runtime = "nodejs";
export const maxDuration = 60;

const bodySchema = z.object({
  query: z.string().min(1).max(2000),
  searchLimit: z.number().int().min(1).max(15).optional(),
  retrieveTopK: z.number().int().min(1).max(50).optional(),
  contextTopK: z.number().int().min(1).max(12).optional(),
  generateAnswer: z.boolean().optional(),
  enrichThinPages: z.boolean().optional(),
  saveHistory: z.boolean().optional().default(true),
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

  const input = parsed.data;

  return createSseResponse(async (emit) => {
    const result = await runWebSearchPipeline(input, emit);
    if (input.saveHistory !== false) {
      try {
        await saveSearchRun({
          query: input.query,
          results: result.results,
          answer: result.answer,
          timing: result.timing,
          metrics: result.metrics,
        });
      } catch {
        // history is optional
      }
    }
  });
}
