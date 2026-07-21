import { z } from "zod";
import { requireUserId } from "@/lib/auth";
import { getNotebook, loadChunks } from "@/lib/db/notebooks-repo";
import { addNotebookMessage } from "@/lib/db/notebook-messages-repo";
import { runNotebookAskPipeline } from "@/lib/pipeline/notebook-ask";
import { createSseResponse } from "@/lib/sse";
import { RETRIEVAL_MODE_IDS } from "@/lib/ir/retrieval-modes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const bodySchema = z.object({
  query: z.string().min(1).max(2000),
  sourceIds: z.array(z.string()).optional(),
  /** Extra notebook IDs (checked datasets) merged into this ask corpus */
  notebookIds: z.array(z.string().min(1)).max(20).optional(),
  contextTopK: z.number().int().min(1).max(12).optional(),
  retrieveTopK: z.number().int().min(1).max(80).optional(),
  documentTopK: z.number().int().min(1).max(20).optional(),
  generateAnswer: z.boolean().optional(),
  /** Per-request retrieval method; defaults to RETRIEVAL_MODE env. */
  retrievalMode: z.enum(RETRIEVAL_MODE_IDS).optional(),
  llmModel: z.string().trim().min(1).max(160).optional(),
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

  // Primary notebook + optional checked corpora for multi-dataset ask
  const extraIds = [
    ...new Set(
      (parsed.data.notebookIds || []).filter((nid) => nid && nid !== id),
    ),
  ].slice(0, 19);
  const corpusIds = [id, ...extraIds];

  const [notebook, ...chunkLists] = await Promise.all([
    getNotebook(id),
    ...corpusIds.map((nid) =>
      loadChunks(
        nid,
        // source filter only applies to the primary notebook workspace
        nid === id ? parsed.data.sourceIds : undefined,
      ),
    ),
  ]);
  if (!notebook) {
    return Response.json({ error: "Notebook not found" }, { status: 404 });
  }

  // Merge retrieval units; prefix chunk ids when multi-corpus to avoid collisions
  const multi = corpusIds.length > 1;
  const chunks = chunkLists.flatMap((list, i) => {
    const nid = corpusIds[i];
    if (!multi) return list;
    return list.map((c) => ({
      ...c,
      chunkId: `${nid}:${c.chunkId}`,
      // Keep documentId stable for source drawer within its notebook —
      // rank UI uses document title; multi-corpus titles already differ.
    }));
  });

  if (chunks.length === 0) {
    return Response.json(
      {
        error:
          corpusIds.length > 1
            ? "Selected datasets have no sources. Upload documents or uncheck empty datasets."
            : "Notebook has no sources. Store a raw document first.",
      },
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
          retrievalMode: parsed.data.retrievalMode,
          llmModel: parsed.data.llmModel,
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
