import { z } from "zod";
import { requireUserId } from "@/lib/auth";
import { getNotebook, loadChunks } from "@/lib/db/notebooks-repo";
import { addNotebookMessage } from "@/lib/db/notebook-messages-repo";
import { runNotebookAskPipeline } from "@/lib/pipeline/notebook-ask";
import { createSseResponse } from "@/lib/sse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const bodySchema = z.object({
  query: z.string().min(1).max(2000),
  sourceIds: z.array(z.string()).optional(),
  contextTopK: z.number().int().min(1).max(12).optional(),
  retrieveTopK: z.number().int().min(1).max(80).optional(),
  documentTopK: z.number().int().min(1).max(20).optional(),
  generateAnswer: z.boolean().optional(),
});

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = requireUserId(req);
  if ("error" in auth) return auth.error;

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
      { error: "Notebook has no sources. Store a raw document first." },
      { status: 400 },
    );
  }

  const query = parsed.data.query.trim();

  return createSseResponse(async (emit, { signal }) => {
    try {
      await addNotebookMessage({
        notebookId: id,
        userId: auth.userId,
        role: "user",
        content: query,
        status: "completed",
      });
    } catch (err) {
      console.error(
        "[notebook ask] save user message",
        err instanceof Error ? err.message : err,
      );
    }

    try {
      const result = await runNotebookAskPipeline(
        {
          query,
          chunks,
          contextTopK: parsed.data.contextTopK,
          retrieveTopK: parsed.data.retrieveTopK,
          documentTopK: parsed.data.documentTopK ?? 10,
          generateAnswer: parsed.data.generateAnswer,
          signal,
        },
        emit,
      );

      try {
        await addNotebookMessage({
          notebookId: id,
          userId: auth.userId,
          role: "assistant",
          content: result.answer || "",
          results: result.results,
          timing: result.timing,
          metrics: result.metrics,
          documents: result.documents,
          status: "completed",
        });
      } catch (err) {
        console.error(
          "[notebook ask] save assistant message",
          err instanceof Error ? err.message : err,
        );
      }
    } catch (err) {
      if ((err as Error)?.name === "AbortError") throw err;
      const message = err instanceof Error ? err.message : "Ask failed";
      try {
        await addNotebookMessage({
          notebookId: id,
          userId: auth.userId,
          role: "assistant",
          content: `Error: ${message}`,
          status: "failed",
        });
      } catch {
        /* best-effort */
      }
      emit({ type: "error", message });
    }
  }, req);
}
