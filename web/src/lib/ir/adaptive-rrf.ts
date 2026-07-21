import { getConfig, IR_DEFAULTS } from "@/lib/config";
import { bm25Retrieve, tokenize } from "./bm25";
import { crossEncoderScore } from "./cross-encoder";
import { cosineSimilarity, embedTexts, resolveDenseEmbedOptions } from "./embedding";
import { parseRetrievalMode } from "./retrieval-modes";
import type { Chunk, ChunkWithEmbedding, RankedChunk } from "./types";

export type HybridRetrievalDiagnostics = {
  mode: "bm25" | "paper" | "adaptive_rrf" | "sgaf" | "bm25_fallback";
  denseUsed: boolean;
  denseSkippedReason?: string;
  embeddingProvider?: string;
  embeddingModel?: string;
  embeddingMs?: number;
  bm25Ms?: number;
  denseMs?: number;
  fusionMs?: number;
  bm25Weight?: number;
  /** True when corpus vectors came from DB (query-only embed). */
  usedPreindexedVectors?: boolean;
  preindexedCount?: number;
  coldEmbedCount?: number;
  /** Paper mode cross-encoder */
  rerankUsed?: boolean;
  rerankModel?: string;
  rerankMs?: number;
  rerankSkippedReason?: string;
};

export type HybridRetrievalResult = {
  results: RankedChunk[];
  diagnostics: HybridRetrievalDiagnostics;
};

function porterStem(word: string) {
  let w = word.toLowerCase();
  if (w.endsWith("ies") && w.length > 3) w = `${w.slice(0, -3)}y`;
  else if (w.endsWith("es") && w.length > 3) w = w.slice(0, -2);
  else if (w.endsWith("s") && !w.endsWith("ss") && w.length > 2) w = w.slice(0, -1);
  if (w.endsWith("ing") && w.length > 5) w = w.slice(0, -3);
  if (w.endsWith("ed") && w.length > 4) w = w.slice(0, -2);
  if (w.endsWith("tion") && w.length > 5) w = `${w.slice(0, -4)}t`;
  return w;
}

function median(values: number[]) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function buildIdfVocabulary(chunks: Chunk[], minDf = 1) {
  const df = new Map<string, number>();
  for (const chunk of chunks) {
    const terms = new Set(
      tokenize(chunk.text)
        .map(porterStem)
        .filter((t) => t.length >= 3),
    );
    for (const term of terms) df.set(term, (df.get(term) || 0) + 1);
  }

  const total = chunks.length;
  const idf = new Map<string, number>();
  for (const [term, count] of df) {
    if (count >= minDf) idf.set(term, Math.log(total / count));
  }
  return idf;
}

function queryMeanIdf(query: string, idf: Map<string, number>, fallback: number) {
  const stems = tokenize(query)
    .map(porterStem)
    .filter((t) => t.length >= 3);
  if (stems.length === 0) return fallback;
  return stems.reduce((sum, term) => sum + (idf.get(term) ?? fallback), 0) / stems.length;
}

/** Kept for SGAF / diagnostics parity; Paper uses classic equal-weight RRF. */
export function adaptiveBm25Weight(query: string, chunks: Chunk[]) {
  const idf = buildIdfVocabulary(chunks);
  const fallback = median([...idf.values()]);
  const meanIdf = queryMeanIdf(query, idf, fallback);
  const logit = IR_DEFAULTS.adaptiveRrfScale * (meanIdf - fallback);
  const sigmoid = 1 / (1 + Math.exp(-logit));
  return (
    IR_DEFAULTS.adaptiveRrfMinBm25Weight +
    sigmoid *
      (IR_DEFAULTS.adaptiveRrfMaxBm25Weight -
        IR_DEFAULTS.adaptiveRrfMinBm25Weight)
  );
}

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

/** Most common embeddingModel among units that already have vectors. */
function majorityEmbeddingModel(
  chunks: ChunkWithEmbedding[],
): string | null {
  const counts = new Map<string, number>();
  for (const c of chunks) {
    if (!c.embedding?.length || !c.embeddingModel) continue;
    counts.set(c.embeddingModel, (counts.get(c.embeddingModel) || 0) + 1);
  }
  let best: string | null = null;
  let bestN = 0;
  for (const [model, n] of counts) {
    if (n > bestN) {
      best = model;
      bestN = n;
    }
  }
  return best;
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

/**
 * Paper mode: Hybrid (SciNCL + BM25) then cross-encoder rerank (query, document).
 * Replaces Adaptive RRF in the product UI.
 */
async function paperRetrieve(
  query: string,
  chunks: ChunkWithEmbedding[],
  topK: number,
): Promise<HybridRetrievalResult> {
  if (chunks.length === 0) {
    return {
      results: [],
      diagnostics: { mode: "paper", denseUsed: false },
    };
  }

  const cfg = getConfig();
  const candidateTopK = Math.max(
    topK,
    IR_DEFAULTS.paperCandidateTopK,
    IR_DEFAULTS.denseTopK,
  );
  const bm25Start = performance.now();
  const bm25All = bm25Retrieve(query, chunks, candidateTopK);
  const bm25Ms = Math.round(performance.now() - bm25Start);

  // Cap dense input for latency; prefer BM25 shortlist when corpus is large.
  const selectedIds = new Set(
    bm25All.slice(0, IR_DEFAULTS.maxDenseChunks).map((hit) => hit.chunkId),
  );
  const denseInputChunks =
    chunks.length > IR_DEFAULTS.maxDenseChunks
      ? chunks.filter((chunk) => selectedIds.has(chunk.chunkId))
      : chunks;
  const bm25 = bm25All.filter((hit) => selectedIds.has(hit.chunkId));
  const byId = new Map(denseInputChunks.map((c) => [c.chunkId, c]));

  // Hot path: reuse DB vectors; only embed units missing embedding_json.
  // Cold path: embed shortlist with the dense index model (SciNCL for Paper).
  const preindexedCount = denseInputChunks.filter(
    (c) => c.embedding && c.embedding.length > 0,
  ).length;
  const needEmbed = denseInputChunks.filter(
    (c) => !c.embedding || c.embedding.length === 0,
  );
  const storedModel = majorityEmbeddingModel(denseInputChunks);
  const embedOpts = resolveDenseEmbedOptions(cfg, storedModel);

  const start = performance.now();
  try {
    let embeddedChunks: ChunkWithEmbedding[] = denseInputChunks;
    let queryEmbedding: number[];
    let embeddingProvider = "";
    let embeddingModel = embedOpts.model;

    if (needEmbed.length === 0) {
      // Index ready — query vector only
      const response = await embedTexts(
        [formatQueryForEmbedding(query)],
        embedOpts,
      );
      queryEmbedding = response.embeddings[0];
      embeddingProvider = response.provider;
      embeddingModel = response.model;
    } else {
      const response = await embedTexts(
        [formatQueryForEmbedding(query), ...needEmbed.map((c) => c.text)],
        embedOpts,
      );
      const [qVec, ...docVecs] = response.embeddings;
      queryEmbedding = qVec;
      embeddingProvider = response.provider;
      embeddingModel = response.model;
      const byMissing = new Map(
        needEmbed.map((c, i) => [c.chunkId, docVecs[i]] as const),
      );
      embeddedChunks = denseInputChunks.map((c) => {
        const filled = byMissing.get(c.chunkId);
        return filled
          ? { ...c, embedding: filled, embeddingModel: response.model }
          : c;
      });
    }

    const embeddingMs = Math.round(performance.now() - start);
    const usedPreindexedVectors = preindexedCount > 0 && needEmbed.length === 0;
    const denseStart = performance.now();
    const dense = denseRetrieve(
      embeddedChunks,
      queryEmbedding,
      Math.max(topK, IR_DEFAULTS.denseTopK),
    );
    const denseMs = Math.round(performance.now() - denseStart);

    if (dense.length === 0) {
      // Still try CE over BM25-only candidates
      return await applyCrossEncoderRerank({
        query,
        hybrid: bm25.slice(0, IR_DEFAULTS.paperRerankTopK).map((hit, i) =>
          safeRankedChunk(byId.get(hit.chunkId) || hit, {
            bm25Score: hit.bm25Score,
            bm25Rank: hit.bm25Rank,
            finalScore: hit.bm25Score,
            finalRank: i + 1,
            retrievalMode: "paper",
          }),
        ),
        byId: new Map(embeddedChunks.map((c) => [c.chunkId, c])),
        topK,
        diagnosticsBase: {
          mode: "paper",
          denseUsed: false,
          denseSkippedReason: "No dense hits",
          embeddingProvider,
          embeddingModel,
          usedPreindexedVectors,
          preindexedCount,
          coldEmbedCount: needEmbed.length,
          embeddingMs,
          bm25Ms,
          denseMs,
          fusionMs: 0,
        },
      });
    }

    // Classic equal-weight RRF for Hybrid (SciNCL + BM25)
    const fusionStart = performance.now();
    const scores = new Map<string, number>();
    const bm25Map = new Map(bm25.map((hit) => [hit.chunkId, hit]));
    const denseMap = new Map(dense.map((hit) => [hit.chunk.chunkId, hit]));
    const embById = new Map(embeddedChunks.map((c) => [c.chunkId, c]));

    for (const hit of bm25) {
      scores.set(
        hit.chunkId,
        (scores.get(hit.chunkId) || 0) + 1 / (IR_DEFAULTS.rrfK + hit.bm25Rank),
      );
    }
    for (const hit of dense) {
      scores.set(
        hit.chunk.chunkId,
        (scores.get(hit.chunk.chunkId) || 0) +
          1 / (IR_DEFAULTS.rrfK + hit.rank),
      );
    }

    const hybridPool = [...scores.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, IR_DEFAULTS.paperRerankTopK)
      .map(([chunkId, rrfScore], i) => {
        const chunk = embById.get(chunkId);
        if (!chunk) return null;
        const bm25Hit = bm25Map.get(chunkId);
        const denseHit = denseMap.get(chunkId);
        return safeRankedChunk(chunk, {
          bm25Score: bm25Hit?.bm25Score ?? 0,
          bm25Rank: bm25Hit?.bm25Rank ?? 0,
          denseScore: denseHit?.score,
          denseRank: denseHit?.rank,
          finalScore: rrfScore,
          finalRank: i + 1,
          retrievalMode: "paper",
        });
      })
      .filter((r): r is RankedChunk => Boolean(r));
    const fusionMs = Math.round(performance.now() - fusionStart);

    return await applyCrossEncoderRerank({
      query,
      hybrid: hybridPool,
      byId: embById,
      topK,
      diagnosticsBase: {
        mode: "paper",
        denseUsed: true,
        embeddingProvider,
        embeddingModel,
        embeddingMs,
        bm25Ms,
        denseMs,
        fusionMs,
        usedPreindexedVectors,
        preindexedCount,
        coldEmbedCount: needEmbed.length,
      },
    });
  } catch (err) {
    const fallback = bm25Fallback(
      query,
      chunks,
      topK,
      err instanceof Error ? err.message : "Paper dense retrieval failed",
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

async function applyCrossEncoderRerank(params: {
  query: string;
  hybrid: RankedChunk[];
  byId: Map<string, ChunkWithEmbedding | Chunk>;
  topK: number;
  diagnosticsBase: HybridRetrievalDiagnostics;
}): Promise<HybridRetrievalResult> {
  if (params.hybrid.length === 0) {
    return {
      results: [],
      diagnostics: {
        ...params.diagnosticsBase,
        rerankUsed: false,
        rerankSkippedReason: "Empty hybrid pool",
      },
    };
  }

  const ce = await crossEncoderScore(
    params.query,
    params.hybrid.map((h) => ({ id: h.chunkId, text: h.text })),
  );

  if (!ce.used) {
    // Keep hybrid order when CE unavailable
    return {
      results: params.hybrid.slice(0, params.topK).map((r, i) => ({
        ...r,
        finalRank: i + 1,
        citationId: i + 1,
        retrievalMode: "paper",
      })),
      diagnostics: {
        ...params.diagnosticsBase,
        rerankUsed: false,
        rerankModel: ce.model,
        rerankMs: ce.ms,
        rerankSkippedReason: ce.skippedReason,
      },
    };
  }

  const scoreById = new Map(ce.scores.map((s) => [s.id, s.score]));
  const reranked = [...params.hybrid]
    .sort(
      (a, b) =>
        (scoreById.get(b.chunkId) ?? Number.NEGATIVE_INFINITY) -
        (scoreById.get(a.chunkId) ?? Number.NEGATIVE_INFINITY),
    )
    .slice(0, params.topK)
    .map((r, i) => ({
      ...r,
      finalScore: scoreById.get(r.chunkId) ?? r.finalScore,
      finalRank: i + 1,
      citationId: i + 1,
      retrievalMode: "paper" as const,
    }));

  return {
    results: reranked,
    diagnostics: {
      ...params.diagnosticsBase,
      rerankUsed: true,
      rerankModel: ce.model,
      rerankMs: ce.ms,
    },
  };
}

export async function retrieveEvidence(
  query: string,
  chunks: ChunkWithEmbedding[],
  topK: number,
  mode: "bm25" | "paper" | "adaptive_rrf" | "sgaf" = "bm25",
): Promise<HybridRetrievalResult> {
  const resolved = parseRetrievalMode(
    mode,
    mode === "bm25" ? "bm25" : mode === "sgaf" ? "sgaf" : "paper",
  );
  if (resolved === "bm25") return bm25Fallback(query, chunks, topK);

  // Paper replaces Adaptive (adaptive_rrf aliases → paper in parseRetrievalMode).
  // SGAF keeps its own implementation when specialist model is configured.
  if (resolved === "sgaf") {
    const cfg = getConfig();
    const specialist = cfg.SPECIALIST_EMBEDDING_MODEL;
    if (specialist) {
      const { sgafRetrieve } = await import("./sgaf");
      const generalist = cfg.EMBEDDING_MODEL;
      const result = await sgafRetrieve(
        query,
        chunks,
        topK,
        async (texts, model) => {
          const res = await embedTexts(texts, {
            model: model || generalist,
          });
          return res.embeddings;
        },
        specialist,
        generalist,
      );
      return {
        results: result.results,
        diagnostics: result.diagnostics,
      };
    }
    // No specialist → same hybrid stack as Paper (better than silent BM25).
    return paperRetrieve(query, chunks, topK);
  }

  return paperRetrieve(query, chunks, topK);
}
