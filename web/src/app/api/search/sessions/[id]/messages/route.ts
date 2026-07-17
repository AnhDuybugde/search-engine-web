import { z } from "zod";
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
});

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: sessionId } = await ctx.params;
  const session = await getSession(sessionId);
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
  const priorMessages = await listMessages(sessionId);

  return createSseResponse(async (emit) => {
    const memory = buildMemoryFromSession({
      entities: session.entities,
      summary: session.summary,
      turns: priorMessages.map((m) => ({ role: m.role, content: m.content })),
    });

    const expansion = await expandQuery(input.query.trim(), memory);
    emit({
      type: "query_expanded",
      original: expansion.originalQuery,
      expanded: expansion.expandedQuery,
      usedContext: expansion.usedContext,
      method: expansion.method,
    });

    const userMsg = await addMessage({
      sessionId,
      role: "user",
      content: expansion.originalQuery,
      expandedQuery: expansion.expandedQuery,
      status: "completed",
    });

    // Auto-title on first user message
    if (priorMessages.length === 0 && session.title === "New chat") {
      await updateSession(sessionId, {
        title: titleFromQuery(expansion.originalQuery),
      });
    }

    emit({ type: "search_started", query: expansion.expandedQuery });

    // Drop pipeline's run_completed; we emit a richer one after persisting messages.
    const pipelineEmit = (event: Parameters<typeof emit>[0]) => {
      if (event.type === "run_completed") return;
      emit(event);
    };

    const result = await runWebSearchPipeline(
      {
        query: expansion.expandedQuery,
        searchLimit: input.searchLimit,
        retrieveTopK: input.retrieveTopK,
        contextTopK: input.contextTopK,
        generateAnswer: input.generateAnswer,
        enrichThinPages: input.enrichThinPages ?? false,
      },
      pipelineEmit,
    );

    const finalAnswer = result.answer;
    const finalResults = result.results;
    const finalTiming = result.timing;
    const finalMetrics = result.metrics;

    const assistantMsg = await addMessage({
      sessionId,
      role: "assistant",
      content: finalAnswer || "",
      results: finalResults,
      timing: finalTiming,
      metrics: finalMetrics,
      status: "completed",
    });

    // Update entity memory from expansion + answer proper nouns
    const fromAnswer = entitiesFromText(finalAnswer || "");
    const nextEntities = mergeEntities(
      session.entities,
      mergeEntities(expansion.entitiesDelta, fromAnswer),
    );
    await updateSession(sessionId, { entities: nextEntities });

    emit({
      type: "run_completed",
      answer: finalAnswer,
      timing: finalTiming,
      metrics: finalMetrics,
      results: finalResults,
      messageIds: { userId: userMsg.id, assistantId: assistantMsg.id },
      sessionId,
      expandedQuery: expansion.expandedQuery,
    });
  });
}
