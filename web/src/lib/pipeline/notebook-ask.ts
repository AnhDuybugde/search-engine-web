import { getConfig, IR_DEFAULTS } from "@/lib/config";
import { retrieveEvidence } from "@/lib/ir/adaptive-rrf";
import { packContext } from "@/lib/ir/packer";
import type {
  ChunkWithEmbedding,
  Metrics,
  RankedChunk,
  StreamEvent,
  Timing,
} from "@/lib/ir/types";
import { streamAnswer } from "@/lib/llm/client";
import { elapsed, nowMs } from "@/lib/utils";

export async function runNotebookAskPipeline(
  input: {
    query: string;
    chunks: ChunkWithEmbedding[];
    contextTopK?: number;
    generateAnswer?: boolean;
  },
  emit: (event: StreamEvent) => void,
): Promise<{
  answer: string;
  results: RankedChunk[];
  timing: Timing;
  metrics: Metrics;
}> {
  const cfg = getConfig();
  const query = input.query.trim();
  if (!query) throw new Error("Query is required");

  const totalStart = nowMs();
  const timing: Timing = {};
  const metrics: Metrics = {
    chunkCount: input.chunks.length,
  };

  emit({ type: "search_started", query });
  emit({ type: "search_completed", count: input.chunks.length, ms: 0 });
  emit({ type: "fetch_completed", pages: 0, ms: 0 });
  emit({ type: "chunk_completed", chunks: input.chunks.length, ms: 0 });

  const retrieveStart = nowMs();
  const retrieval = await retrieveEvidence(
    query,
    input.chunks,
    IR_DEFAULTS.retrieveTopK,
    cfg.RETRIEVAL_MODE,
  );
  const candidates = retrieval.results;
  const results = packContext(
    candidates,
    input.contextTopK ?? IR_DEFAULTS.contextTopK,
    3,
  );
  timing.retrieveMs = elapsed(retrieveStart);
  timing.embeddingMs = retrieval.diagnostics.embeddingMs;
  metrics.contextCount = results.length;
  metrics.sourcesUsed = new Set(results.map((r) => r.documentId)).size;
  metrics.retrievalMode = retrieval.diagnostics.mode;
  metrics.denseUsed = retrieval.diagnostics.denseUsed;
  metrics.denseSkippedReason = retrieval.diagnostics.denseSkippedReason;
  metrics.embeddingProvider = retrieval.diagnostics.embeddingProvider;
  metrics.embeddingModel = retrieval.diagnostics.embeddingModel;
  metrics.bm25Weight = retrieval.diagnostics.bm25Weight;
  emit({ type: "retrieve_completed", results, ms: timing.retrieveMs });

  let answer = "";
  const generateAnswer = input.generateAnswer ?? true;

  if (!generateAnswer) {
    metrics.llmUsed = false;
    metrics.llmSkippedReason = "generateAnswer=false";
  } else if (!cfg.hasLlm) {
    metrics.llmUsed = false;
    metrics.llmSkippedReason = "LLM_API_KEY not configured";
  } else if (results.length === 0) {
    metrics.llmUsed = false;
    metrics.llmSkippedReason = "No evidence chunks";
    answer = "No relevant content found in this notebook.";
  } else {
    emit({ type: "generation_started" });
    const genStart = nowMs();
    try {
      answer = await streamAnswer({
        query,
        chunks: results,
        onToken: async (token) => emit({ type: "generation_token", token }),
      });
      metrics.llmUsed = true;
    } catch (err) {
      metrics.llmUsed = false;
      metrics.llmSkippedReason =
        err instanceof Error ? err.message : "LLM generation failed";
      emit({
        type: "error",
        message: `Generation failed: ${metrics.llmSkippedReason}`,
      });
    }
    timing.generateMs = elapsed(genStart);
  }

  timing.totalMs = elapsed(totalStart);
  emit({ type: "run_completed", answer, timing, metrics, results });
  return { answer, results, timing, metrics };
}
