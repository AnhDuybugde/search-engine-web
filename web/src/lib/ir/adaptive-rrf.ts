import { IR_DEFAULTS } from "@/lib/config";
import { bm25Retrieve } from "./bm25";
import { cosineSimilarity, embedTexts } from "./embedding";
import type { Chunk, ChunkWithEmbedding, RankedChunk } from "./types";

export type HybridRetrievalDiagnostics = {
  mode: "bm25" | "rrf" | "bm25_fallback";
  denseUsed: boolean;
  denseSkippedReason?: string;
  embeddingProvider?: string;
  embeddingModel?: string;
  embeddingMs?: number;
  bm25Ms?: number;
  denseMs?: number;
  fusionMs?: number;
  bm25Weight?: number;
};

export type HybridRetrievalResult = {
  results: RankedChunk[];
  diagnostics: HybridRetrievalDiagnostics;
};

function denseRetrieve(
  chunks: ChunkWithEmbedding[],
  queryEmbedding: number[],
  topK: number,
) {
  return chunks
    .map((chunk) => ({
      chunk,
      score: chunk.embedding
        ? cosineSimilarity(queryEmbedding, chunk.embedding)
        : Number.NEGATIVE_INFINITY,
    }))
    .filter((item) => Number.isFinite(item.score))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map((item, i) => ({ ...item, rank: i + 1 }));
}

function formatQueryForEmbedding(query: string) {
  return `Represent this sentence for searching relevant passages: ${query}`;
}

function safeRankedChunk(
  chunk: Chunk,
  scores: {
    bm25Score: number;
    bm25Rank: number;
    denseScore?: number;
    denseRank?: number;
    finalScore: number;
    finalRank: number;
    retrievalMode: RankedChunk["retrievalMode"];
    bm25Weight?: number;
  },
): RankedChunk {
  return {
    chunkId: chunk.chunkId,
    documentId: chunk.documentId,
    title: chunk.title,
    url: chunk.url,
    text: chunk.text,
    chunkIndex: chunk.chunkIndex,
    bm25Score: scores.bm25Score,
    bm25Rank: scores.bm25Rank,
    denseScore: scores.denseScore,
    denseRank: scores.denseRank,
    finalScore: scores.finalScore,
    finalRank: scores.finalRank,
    citationId: scores.finalRank,
    retrievalMode: scores.retrievalMode,
    bm25Weight: scores.bm25Weight,
  };
}

function bm25Fallback(
  query: string,
  chunks: Chunk[],
  topK: number,
  reason?: string,
): HybridRetrievalResult {
  const bm25Start = performance.now();
  const results = bm25Retrieve(query, chunks, topK).map((r) => ({
    ...r,
    retrievalMode: (reason ? "bm25_fallback" : "bm25") as RankedChunk["retrievalMode"],
  }));
  const bm25Ms = Math.round(performance.now() - bm25Start);
  return {
    results,
    diagnostics: {
      mode: reason ? "bm25_fallback" : "bm25",
      denseUsed: false,
      denseSkippedReason: reason,
      bm25Ms,
      fusionMs: 0,
      denseMs: 0,
    },
  };
}

export async function retrieveEvidence(
  query: string,
  chunks: ChunkWithEmbedding[],
  topK: number,
  mode: "bm25" | "rrf" | "adaptive_rrf" = "bm25",
): Promise<HybridRetrievalResult> {
  // adaptive_rrf is a legacy env alias for classic equal-weight RRF
  if (mode === "bm25") return bm25Fallback(query, chunks, topK);
  if (chunks.length === 0) {
    return {
      results: [],
      diagnostics: { mode: "rrf", denseUsed: false },
    };
  }

  const bm25TopK = Math.max(topK, IR_DEFAULTS.denseTopK, IR_DEFAULTS.maxDenseChunks);
  const bm25Start = performance.now();
  const bm25All = bm25Retrieve(query, chunks, bm25TopK);
  const bm25Ms = Math.round(performance.now() - bm25Start);
  const selectedIds = new Set(
    bm25All.slice(0, IR_DEFAULTS.maxDenseChunks).map((hit) => hit.chunkId),
  );
  const denseInputChunks =
    chunks.length > IR_DEFAULTS.maxDenseChunks
      ? chunks.filter((chunk) => selectedIds.has(chunk.chunkId))
      : chunks;
  const bm25 = bm25All.filter((hit) => selectedIds.has(hit.chunkId));
  const byId = new Map(denseInputChunks.map((chunk) => [chunk.chunkId, chunk]));

  const start = performance.now();
  try {
    const missing = denseInputChunks.filter(
      (chunk) => !chunk.embedding || chunk.embedding.length === 0,
    );
    let embeddingProvider = "";
    let embeddingModel = "";
    let embeddedChunks: ChunkWithEmbedding[] = denseInputChunks;

    // Hot path: pre-indexed corpus → embed query only
    // Cold path: embed query + only missing corpus units (not re-embed all)
    if (missing.length > 0) {
      const response = await embedTexts([
        formatQueryForEmbedding(query),
        ...missing.map((chunk) => chunk.text),
      ]);
      const [queryEmbedding, ...missingVectors] = response.embeddings;
      const byMissing = new Map(
        missing.map((chunk, i) => [chunk.chunkId, missingVectors[i]] as const),
      );
      embeddedChunks = denseInputChunks.map((chunk) => {
        const filled = byMissing.get(chunk.chunkId);
        if (filled) {
          return {
            ...chunk,
            embedding: filled,
            embeddingModel: response.model,
          };
        }
        return chunk;
      });
      embeddingProvider = response.provider;
      embeddingModel = response.model;

      return fuseRuns({
        query,
        chunks: embeddedChunks,
        queryEmbedding,
        bm25,
        byId: new Map(embeddedChunks.map((chunk) => [chunk.chunkId, chunk])),
        topK,
        embeddingMs: Math.round(performance.now() - start),
        bm25Ms,
        embeddingProvider,
        embeddingModel,
      });
    }

    const response = await embedTexts([formatQueryForEmbedding(query)]);
    embeddingProvider = response.provider;
    embeddingModel = response.model;
    return fuseRuns({
      query,
      chunks: embeddedChunks,
      queryEmbedding: response.embeddings[0],
      bm25,
      byId,
      topK,
      embeddingMs: Math.round(performance.now() - start),
      bm25Ms,
      embeddingProvider,
      embeddingModel,
    });
  } catch (err) {
    const fallback = bm25Fallback(
      query,
      chunks,
      topK,
      err instanceof Error ? err.message : "Dense retrieval failed",
    );
    return {
      ...fallback,
      diagnostics: {
        ...fallback.diagnostics,
        bm25Ms: fallback.diagnostics.bm25Ms ?? bm25Ms,
      },
    };
  }
}

function fuseRuns(params: {
  query: string;
  chunks: ChunkWithEmbedding[];
  queryEmbedding: number[];
  bm25: RankedChunk[];
  byId: Map<string, ChunkWithEmbedding>;
  topK: number;
  embeddingMs: number;
  bm25Ms: number;
  embeddingProvider: string;
  embeddingModel: string;
}): HybridRetrievalResult {
  const denseStart = performance.now();
  const dense = denseRetrieve(
    params.chunks,
    params.queryEmbedding,
    Math.max(params.topK, IR_DEFAULTS.denseTopK),
  );
  const denseMs = Math.round(performance.now() - denseStart);
  if (dense.length === 0) {
    return bm25Fallback(
      params.query,
      params.chunks,
      params.topK,
      "No dense embeddings available",
    );
  }

  const fusionStart = performance.now();
  // Classic RRF (Cormack et al.): equal list weights, k constant
  // score(d) = Σ_i 1 / (k + rank_i(d))
  const listWeight = IR_DEFAULTS.rrfListWeight;
  const k = IR_DEFAULTS.rrfK;
  const scores = new Map<string, number>();
  const bm25Map = new Map(params.bm25.map((hit) => [hit.chunkId, hit]));
  const denseMap = new Map(dense.map((hit) => [hit.chunk.chunkId, hit]));

  for (const hit of params.bm25) {
    scores.set(
      hit.chunkId,
      (scores.get(hit.chunkId) || 0) + listWeight / (k + hit.bm25Rank),
    );
  }
  for (const hit of dense) {
    scores.set(
      hit.chunk.chunkId,
      (scores.get(hit.chunk.chunkId) || 0) + listWeight / (k + hit.rank),
    );
  }

  const results = [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, params.topK)
    .map(([chunkId, finalScore], i) => {
      const chunk = params.byId.get(chunkId);
      if (!chunk) return null;
      const bm25Hit = bm25Map.get(chunkId);
      const denseHit = denseMap.get(chunkId);
      return safeRankedChunk(chunk, {
        bm25Score: bm25Hit?.bm25Score ?? 0,
        bm25Rank: bm25Hit?.bm25Rank ?? 0,
        denseScore: denseHit?.score,
        denseRank: denseHit?.rank,
        finalScore,
        finalRank: i + 1,
        retrievalMode: "rrf",
        bm25Weight: listWeight,
      });
    })
    .filter((r): r is RankedChunk => Boolean(r));
  const fusionMs = Math.round(performance.now() - fusionStart);

  return {
    results,
    diagnostics: {
      mode: "rrf",
      denseUsed: true,
      embeddingProvider: params.embeddingProvider,
      embeddingModel: params.embeddingModel,
      embeddingMs: params.embeddingMs,
      bm25Ms: params.bm25Ms,
      denseMs,
      fusionMs,
      bm25Weight: listWeight,
    },
  };
}
