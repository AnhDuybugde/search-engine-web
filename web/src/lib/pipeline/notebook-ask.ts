import { getConfig, IR_DEFAULTS } from "@/lib/config";
import { retrieveEvidence } from "@/lib/ir/adaptive-rrf";
import {
  documentRunMetrics,
  rankDocumentsFromChunks,
} from "@/lib/ir/document-rank";
import { packContext } from "@/lib/ir/packer";
import {
  parseRetrievalMode,
  type RetrievalModeId,
} from "@/lib/ir/retrieval-modes";
import type {
  ChunkWithEmbedding,
  Metrics,
  RankedChunk,
  RankedDocument,
  StreamEvent,
  Timing,
} from "@/lib/ir/types";
import { streamAnswer } from "@/lib/llm/client";
import { elapsed, nowMs } from "@/lib/utils";

function assertNotAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    const err = new Error("Request cancelled");
    err.name = "AbortError";
    throw err;
  }
}

export async function runNotebookAskPipeline(
  input: {
    query: string;
    chunks: ChunkWithEmbedding[];
    contextTopK?: number;
    retrieveTopK?: number;
    documentTopK?: number;
    generateAnswer?: boolean;
    /** Per-request override; falls back to RETRIEVAL_MODE env. */
    retrievalMode?: RetrievalModeId;
    /** Client disconnect / cancel — checked between stages and passed to LLM */
    signal?: AbortSignal;
  },
  emit: (event: StreamEvent) => void,
): Promise<{
  answer: string;
  results: RankedChunk[];
  rankedChunks: RankedChunk[];
  documents: RankedDocument[];
  timing: Timing;
  metrics: Metrics;
}> {
  const cfg = getConfig();
  const query = input.query.trim();
  if (!query) throw new Error("Query is required");
  const signal = input.signal;
  assertNotAborted(signal);

  const documentTopK = input.documentTopK ?? 10;
  const retrieveTopK = Math.max(
    input.retrieveTopK ?? IR_DEFAULTS.retrieveTopK,
    documentTopK,
    20,
  );
  const contextTopK = input.contextTopK ?? IR_DEFAULTS.contextTopK;
  const retrievalMode = parseRetrievalMode(
    input.retrievalMode,
    parseRetrievalMode(cfg.RETRIEVAL_MODE),
  );

  const totalStart = nowMs();
  const timing: Timing = {};
  const metrics: Metrics = {
    chunkCount: input.chunks.length,
  };

  emit({ type: "query_started", query });

  const qpStart = nowMs();
  const processedQuery = query; // placeholder for future expand/normalize
  timing.queryProcessMs = elapsed(qpStart);
  emit({
    type: "query_processed",
    query: processedQuery,
    ms: timing.queryProcessMs,
  });

  emit({
    type: "retrieve_started",
    mode: retrievalMode,
    corpusChunks: input.chunks.length,
  });

  assertNotAborted(signal);
  const retrieveStart = nowMs();
  const retrieval = await retrieveEvidence(
    processedQuery,
    input.chunks,
    retrieveTopK,
    retrievalMode,
  );
  assertNotAborted(signal);
  const candidates = retrieval.results;

  timing.embeddingMs = retrieval.diagnostics.embeddingMs;
  timing.bm25Ms = retrieval.diagnostics.bm25Ms;
  timing.denseMs = retrieval.diagnostics.denseMs;
  timing.fusionMs = retrieval.diagnostics.fusionMs;
  timing.rankMs =
    (timing.bm25Ms ?? 0) +
    (timing.embeddingMs ?? 0) +
    (timing.denseMs ?? 0) +
    (timing.fusionMs ?? 0);

  emit({
    type: "bm25_completed",
    ms: timing.bm25Ms ?? 0,
    candidates: candidates.length,
  });
  emit({
    type: "embedding_completed",
    ms: timing.embeddingMs ?? 0,
    denseUsed: Boolean(retrieval.diagnostics.denseUsed),
    reason: retrieval.diagnostics.denseSkippedReason,
    provider: retrieval.diagnostics.embeddingProvider,
    model: retrieval.diagnostics.embeddingModel,
  });
  emit({
    type: "fusion_completed",
    ms: timing.fusionMs ?? 0,
    bm25Weight: retrieval.diagnostics.bm25Weight,
    method: retrieval.diagnostics.mode,
  });

  const documents = rankDocumentsFromChunks(candidates, documentTopK);
  const docMetrics = documentRunMetrics(documents);
  /** Ranking hits for UI drawer — keep separate from packed LLM context */
  const rankedChunks = candidates.slice(
    0,
    Math.min(candidates.length, Math.max(40, documentTopK * 4)),
  );

  const packStart = nowMs();
  const results = packContext(candidates, contextTopK, 3);
  timing.packMs = elapsed(packStart);
  timing.retrieveMs = elapsed(retrieveStart);

  emit({
    type: "pack_completed",
    ms: timing.packMs,
    packed: results.length,
  });
  emit({
    type: "rank_completed",
    documents,
    chunks: rankedChunks,
    ms: timing.rankMs ?? timing.retrieveMs,
  });
  // packed evidence only — clients must not treat this as full ranking list
  emit({ type: "retrieve_completed", results, ms: timing.retrieveMs });
  assertNotAborted(signal);

  metrics.contextCount = results.length;
  metrics.sourcesUsed = new Set(results.map((r) => r.documentId)).size;
  metrics.retrievalMode = retrieval.diagnostics.mode;
  metrics.denseUsed = retrieval.diagnostics.denseUsed;
  metrics.denseSkippedReason = retrieval.diagnostics.denseSkippedReason;
  metrics.embeddingProvider = retrieval.diagnostics.embeddingProvider;
  metrics.embeddingModel = retrieval.diagnostics.embeddingModel;
  metrics.bm25Weight = retrieval.diagnostics.bm25Weight;
  metrics.documentsRanked = docMetrics.documentsRanked;
  metrics.topKDocuments = docMetrics.topKDocuments;
  metrics.confidenceMean = docMetrics.confidenceMean;
  metrics.confidenceMax = docMetrics.confidenceMax;
  metrics.scoreMargin = docMetrics.scoreMargin;

  let answer = "";
  const generateAnswer = input.generateAnswer ?? true;
  let firstTokenAt: number | null = null;

  if (!generateAnswer) {
    metrics.llmUsed = false;
    metrics.llmSkippedReason = "generateAnswer=false";
    answer = "Answer generation was disabled for this request.";
  } else if (!cfg.hasLlm) {
    metrics.llmUsed = false;
    metrics.llmSkippedReason = "LLM_API_KEY not configured";
    answer =
      "Notebook retrieval completed, but LLM_API_KEY is not configured so no answer could be generated.";
  } else if (results.length === 0) {
    metrics.llmUsed = false;
    metrics.llmSkippedReason = "No evidence chunks";
    answer = "No relevant content found in this notebook.";
  } else {
    emit({ type: "generation_started" });
    const genStart = nowMs();
    try {
      answer = await streamAnswer({
        query: processedQuery,
        chunks: results,
        signal,
        onToken: async (token) => {
          if (firstTokenAt == null) firstTokenAt = nowMs();
          emit({ type: "generation_token", token });
        },
      });
      metrics.llmUsed = true;
      if (firstTokenAt != null) {
        timing.ttftMs = Math.round(firstTokenAt - genStart);
      }
    } catch (err) {
      if ((err as Error)?.name === "AbortError") throw err;
      metrics.llmUsed = false;
      metrics.llmSkippedReason =
        err instanceof Error ? err.message : "LLM generation failed";
      const partial = (err as Error & { partial?: string })?.partial?.trim();
      answer =
        partial ||
        `Generation failed: ${metrics.llmSkippedReason}. Retrieved notebook evidence is still available.`;
      emit({
        type: "error",
        message: `Generation failed: ${metrics.llmSkippedReason}`,
      });
    }
    timing.generateMs = elapsed(genStart);
  }

  timing.totalMs = elapsed(totalStart);
  emit({
    type: "run_completed",
    answer,
    timing,
    metrics,
    results,
    rankedChunks,
    documents,
  });
  return { answer, results, rankedChunks, documents, timing, metrics };
}
