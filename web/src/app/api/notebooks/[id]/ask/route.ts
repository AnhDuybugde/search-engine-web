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

/** Persist history without blocking the answer stream (log failures). */
function persistHistory(
  label: string,
  work: () => Promise<unknown>,
): Promise<void> {
  return work().then(
    () => undefined,
    (err) => {
      console.error(
        `[notebook ask] ${label}`,
        err instanceof Error ? err.message : err,
      );
    },
  );
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = requireUserId(req);
  if ("error" in auth) return auth.error;

  const { id } = await ctx.params;

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: "Invalid body" }, { status: 400 });
  }

  // Parallel DB reads: existence check + retrieval units
  const [notebook, chunks] = await Promise.all([
    getNotebook(id),
    loadChunks(id, parsed.data.sourceIds),
  ]);
  if (!notebook) {
    return Response.json({ error: "Notebook not found" }, { status: 404 });
  }
  if (chunks.length === 0) {
    return Response.json(
      { error: "Notebook has no sources. Store a raw document first." },
      { status: 400 },
    );
  }

  const query = parsed.data.query.trim();

  return createSseResponse(async (emit, { signal }) => {
    // Fire-and-forget user message so TTFT is not blocked on history I/O
    const userSave = persistHistory("save user message", () =>
      addNotebookMessage({
        notebookId: id,
        userId: auth.userId,
        role: "user",
        content: query,
        status: "completed",
      }),
    );

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

      // Persist assistant after answer; still await so stream end ≈ durable history
      await Promise.all([
        userSave,
        persistHistory("save assistant message", () =>
          addNotebookMessage({
            notebookId: id,
            userId: auth.userId,
            role: "assistant",
            content: result.answer || "",
            results: result.results,
            timing: result.timing,
            metrics: result.metrics,
            documents: result.documents,
            status: "completed",
          }),
        ),
      ]);
    } catch (err) {
      if ((err as Error)?.name === "AbortError") throw err;
      const message = err instanceof Error ? err.message : "Ask failed";
      await Promise.all([
        userSave,
        persistHistory("save failed assistant", () =>
          addNotebookMessage({
            notebookId: id,
            userId: auth.userId,
            role: "assistant",
            content: `Error: ${message}`,
            status: "failed",
          }),
        ),
      ]);
      emit({ type: "error", message });
    }
  }, req);
}
