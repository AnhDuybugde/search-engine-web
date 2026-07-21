import { z } from "zod";
import { requireUserId } from "@/lib/auth";
import { getConfig } from "@/lib/config";
import { buildMemoryFromSession, expandQuery } from "@/lib/context/expand";
import { entitiesFromText, mergeEntities } from "@/lib/context/entities";
import {
  addMessage,
  getSession,
  listMessages,
  titleFromQuery,
  updateSession,
} from "@/lib/db/sessions-repo";
import { runWebSearchPipeline } from "@/lib/pipeline/web-search";
import { createSseResponse } from "@/lib/sse";
import { RETRIEVAL_MODE_IDS } from "@/lib/ir/retrieval-modes";

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
  /** Per-request retrieval method; defaults to RETRIEVAL_MODE env. */
  retrievalMode: z.enum(RETRIEVAL_MODE_IDS).optional(),
  llmModel: z.string().trim().min(1).max(160).optional(),
});

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = requireUserId(req);
  if ("error" in auth) return auth.error;

  const { id: sessionId } = await ctx.params;
  const session = await getSession(sessionId, auth.userId);
  if (!session) {
    return Response.json({ error: "Session not found" }, { status: 404 });
  }

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
          "Search provider not configured. Set TAVILY_API_KEY (or BRAVE_API_KEY).",
      },
      { status: 500 },
    );
  }

  const input = parsed.data;
  // Load prior turns while we already know session ownership (parallel-ready path)
  const priorMessages = await listMessages(sessionId);

  return createSseResponse(async (emit, { signal }) => {
    const memory = buildMemoryFromSession({
      entities: session.entities,
      summary: session.summary,
      turns: priorMessages
        .filter((m) => m.content.trim().length > 0)
        .map((m) => ({ role: m.role, content: m.content })),
    });

    const expansion = await expandQuery(input.query.trim(), memory);
    if (signal.aborted) {
      throw Object.assign(new Error("Aborted"), { name: "AbortError" });
    }

    emit({
      type: "query_expanded",
      original: expansion.originalQuery,
      expanded: expansion.expandedQuery,
      usedContext: expansion.usedContext,
      method: expansion.method,
    });
    // Start search immediately — do not wait on history I/O before Tavily
    emit({ type: "search_started", query: expansion.expandedQuery });

    // History write must not cancel a successful search stream
    const userMsgPromise = addMessage({
      sessionId,
      role: "user",
      content: expansion.originalQuery,
      expandedQuery: expansion.expandedQuery,
      status: "completed",
    }).catch((err) => {
      console.warn(
        "[session messages] save user",
        err instanceof Error ? err.message : err,
      );
      return null;
    });

    // Auto-title on first user message (non-blocking)
    if (priorMessages.length === 0 && session.title === "New chat") {
      void updateSession(sessionId, {
        title: titleFromQuery(expansion.originalQuery),
      }).catch((err) =>
        console.warn(
          "[session messages] auto-title",
          err instanceof Error ? err.message : err,
        ),
      );
    }

    // Drop pipeline's run_completed; we emit a richer one after persisting messages.
    const pipelineEmit = (event: Parameters<typeof emit>[0]) => {
      if (event.type === "run_completed") return;
      emit(event);
    };

    try {
      const [userMsgSaved, result] = await Promise.all([
        userMsgPromise,
        runWebSearchPipeline(
          {
            query: expansion.expandedQuery,
            searchLimit: input.searchLimit,
            retrieveTopK: input.retrieveTopK,
            contextTopK: input.contextTopK,
            generateAnswer: input.generateAnswer,
            enrichThinPages: input.enrichThinPages ?? false,
            retrievalMode: input.retrievalMode,
            llmModel: input.llmModel,
            signal,
          },
          pipelineEmit,
        ),
      ]);
      const userMsg = userMsgSaved ?? {
        id: `tmp-u-${Date.now()}`,
        sessionId,
        role: "user" as const,
        content: expansion.originalQuery,
        expandedQuery: expansion.expandedQuery,
        results: null,
        timing: null,
        metrics: null,
        status: "completed",
        createdAt: new Date().toISOString(),
      };

      if (signal.aborted) {
        await addMessage({
          sessionId,
          role: "assistant",
          content: result.answer?.trim() || "Request cancelled.",
          results: result.results,
          timing: result.timing,
          metrics: { ...result.metrics, llmSkippedReason: "aborted" },
          status: "cancelled",
        });
        throw Object.assign(new Error("Aborted"), { name: "AbortError" });
      }

      const finalAnswer = (result.answer || "").trim();
      const generationFailed =
        Boolean(result.metrics.llmSkippedReason) &&
        result.metrics.llmUsed === false &&
        (input.generateAnswer ?? true) &&
        cfg.hasLlm &&
        (result.results?.length ?? 0) > 0 &&
        !finalAnswer;

      const content =
        finalAnswer ||
        (result.metrics.llmSkippedReason
          ? `Unable to generate answer: ${result.metrics.llmSkippedReason}`
          : "No answer was generated.");

      const assistantMsg = await addMessage({
        sessionId,
        role: "assistant",
        content,
        results: result.results,
        timing: result.timing,
        metrics: result.metrics,
        status: generationFailed || !finalAnswer ? "failed" : "completed",
      });

      // Emit completed answer first (realtime UI), then persist memory off the critical path
      emit({
        type: "run_completed",
        answer: content,
        timing: result.timing,
        metrics: result.metrics,
        results: result.results,
        messageIds: { userId: userMsg.id, assistantId: assistantMsg.id },
        sessionId,
        expandedQuery: expansion.expandedQuery,
      });

      const fromAnswer = entitiesFromText(content);
      const nextEntities = mergeEntities(
        session.entities,
        mergeEntities(expansion.entitiesDelta, fromAnswer),
      );
      void updateSession(sessionId, { entities: nextEntities }).catch((err) =>
        console.warn(
          "[session messages] entity update",
          err instanceof Error ? err.message : err,
        ),
      );
    } catch (err) {
      if ((err as Error)?.name === "AbortError") throw err;
      const message = err instanceof Error ? err.message : "Search failed";
      try {
        await addMessage({
          sessionId,
          role: "assistant",
          content: `Error: ${message}`,
          status: "failed",
        });
      } catch {
        /* persistence best-effort */
      }
      emit({ type: "error", message });
    }
  }, req);
}
