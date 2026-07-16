import { z } from "zod";
import { getNotebook, loadChunks } from "@/lib/db/notebooks-repo";
import { runNotebookAskPipeline } from "@/lib/pipeline/notebook-ask";
import { createSseResponse } from "@/lib/sse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const bodySchema = z.object({
  query: z.string().min(1).max(2000),
  sourceIds: z.array(z.string()).optional(),
  contextTopK: z.number().int().min(1).max(12).optional(),
  generateAnswer: z.boolean().optional(),
});

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const notebook = await getNotebook(id);
  if (!notebook) {
    return Response.json({ error: "Notebook not found" }, { status: 404 });
  }

  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: "Invalid body" }, { status: 400 });
  }

  const chunks = await loadChunks(id, parsed.data.sourceIds);
  if (chunks.length === 0) {
    return Response.json(
      { error: "Notebook has no chunks. Upload a document first." },
      { status: 400 },
    );
  }

  return createSseResponse(async (emit) => {
    emit({ type: "search_started", query: parsed.data.query });
    await runNotebookAskPipeline(
      {
        query: parsed.data.query,
        chunks,
        contextTopK: parsed.data.contextTopK,
        generateAnswer: parsed.data.generateAnswer,
      },
      emit,
    );
  });
}
