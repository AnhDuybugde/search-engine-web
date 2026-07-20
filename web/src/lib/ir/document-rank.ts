import type { RankedChunk, RankedDocument } from "./types";

/**
 * Aggregate chunk-level IR hits into document-level ranking.
 *
 * `confidence` is a **display proxy in [0,1] derived from this query's ranked
 * scores** (absolute BM25/dense/final strength + relative margin). It is NOT a
 * calibrated classifier probability.
 */
export function rankDocumentsFromChunks(
  rankedChunks: RankedChunk[],
  topK = 10,
): RankedDocument[] {
  if (rankedChunks.length === 0 || topK <= 0) return [];

  type Agg = {
    documentId: string;
    title: string;
    finalScore: number;
    bm25Best: number;
    denseBest: number;
    hasDense: boolean;
    chunkHits: number;
    topChunkIds: string[];
    snippet: string;
  };

  const byDoc = new Map<string, Agg>();

  for (const chunk of rankedChunks) {
    const score = Number.isFinite(chunk.finalScore)
      ? (chunk.finalScore as number)
      : chunk.bm25Score;
    const existing = byDoc.get(chunk.documentId);
    if (!existing) {
      byDoc.set(chunk.documentId, {
        documentId: chunk.documentId,
        title: chunk.title || "Untitled",
        finalScore: score,
        bm25Best: chunk.bm25Score,
        denseBest: chunk.denseScore ?? Number.NEGATIVE_INFINITY,
        hasDense: chunk.denseScore != null && Number.isFinite(chunk.denseScore),
        chunkHits: 1,
        topChunkIds: [chunk.chunkId],
        snippet: chunk.text.slice(0, 180),
      });
      continue;
    }

    existing.chunkHits += 1;
    if (score > existing.finalScore) {
      existing.finalScore = score;
      existing.snippet = chunk.text.slice(0, 180);
      existing.topChunkIds = [
        chunk.chunkId,
        ...existing.topChunkIds.filter((id) => id !== chunk.chunkId),
      ].slice(0, 5);
    } else if (existing.topChunkIds.length < 5) {
      existing.topChunkIds.push(chunk.chunkId);
    }
    if (chunk.bm25Score > existing.bm25Best) existing.bm25Best = chunk.bm25Score;
    if (
      chunk.denseScore != null &&
      Number.isFinite(chunk.denseScore) &&
      chunk.denseScore > existing.denseBest
    ) {
      existing.denseBest = chunk.denseScore;
      existing.hasDense = true;
    }
  }

  const sorted = [...byDoc.values()].sort((a, b) => b.finalScore - a.finalScore);
  const top = sorted.slice(0, topK);
  const scoreList = top.map((d) => d.finalScore);

  return top.map((doc, i) => ({
    documentId: doc.documentId,
    title: doc.title,
    finalScore: doc.finalScore,
    finalRank: i + 1,
    confidence: documentConfidence({
      finalScore: doc.finalScore,
      bm25Best: doc.bm25Best,
      denseBest: doc.hasDense ? doc.denseBest : undefined,
      rankIndex: i,
      scores: scoreList,
    }),
    bm25Best: doc.bm25Best,
    denseBest: doc.hasDense ? doc.denseBest : undefined,
    chunkHits: doc.chunkHits,
    topChunkIds: doc.topChunkIds,
    snippet: doc.snippet,
  }));
}

/** Soft map [0, ∞) → [0, 1) */
function squash(x: number, scale: number): number {
  if (!Number.isFinite(x) || x <= 0 || scale <= 0) return 0;
  return 1 - Math.exp(-x / scale);
}

function clamp01(x: number, lo = 0.05, hi = 0.98): number {
  if (!Number.isFinite(x)) return lo;
  return Math.min(hi, Math.max(lo, x));
}

/**
 * Per-document display confidence from this run's scores.
 *
 * Absolute strength (BM25 / dense / final) prevents a lone weak hit from
 * showing ~85%. Relative margin distinguishes multi-doc rankings.
 */
export function documentConfidence(opts: {
  finalScore: number;
  bm25Best: number;
  denseBest?: number;
  /** 0-based position in the ranked document list */
  rankIndex: number;
  /** finalScores of the full top list, best-first */
  scores: number[];
}): number {
  const { finalScore, bm25Best, denseBest, rankIndex, scores } = opts;
  const fin = Number.isFinite(finalScore) && finalScore > 0 ? finalScore : 0;
  const bm25 = Number.isFinite(bm25Best) && bm25Best > 0 ? bm25Best : 0;
  const dense =
    denseBest != null && Number.isFinite(denseBest) && denseBest > 0
      ? denseBest
      : 0;

  // Typical ranges: BM25 ~0–15, dense cosine ~0–1, RRF final ~0–0.1
  const abs =
    0.55 * squash(bm25, 3.5) +
    0.25 * squash(dense, 0.4) +
    0.2 * squash(fin, 0.05);

  const top = scores[0] ?? 0;
  const second = scores.length > 1 ? scores[1]! : null;

  // Single document / single score: absolute only — no hardcoded 0.85
  if (scores.length <= 1 || second == null) {
    return clamp01(0.1 + 0.8 * abs, 0.05, 0.9);
  }

  const allEqual = Math.abs(top - Math.min(...scores.map((s) => (Number.isFinite(s) ? s : 0)))) < 1e-12;
  if (allEqual) {
    // Equal competition: absolute only, slightly damped
    return clamp01(0.1 + 0.75 * abs, 0.05, 0.88);
  }

  const margin = top > 1e-12 ? Math.max(0, Math.min(1, (top - second) / top)) : 0;
  const vsTop = top > 1e-12 ? Math.max(0, Math.min(1, fin / top)) : 0;

  const relative =
    rankIndex === 0
      ? 0.4 + 0.6 * margin // top: clear winner vs runner-up
      : 0.15 + 0.7 * vsTop; // others: share of top score

  // Absolute quality dominates; relative cannot invent high conf for weak hits
  const conf = 0.62 * abs + 0.38 * relative * Math.max(abs, 0.12);
  return clamp01(conf, 0.05, 0.98);
}

/**
 * @deprecated Prefer documentConfidence — kept for callers/tests that only
 * have a score list. Equal scores now use a low baseline (not 0.85).
 */
export function normalizeConfidences(scores: number[]): number[] {
  if (scores.length === 0) return [];
  const finite = scores.map((s) => (Number.isFinite(s) ? s : 0));
  return finite.map((s, i) =>
    documentConfidence({
      finalScore: s,
      bm25Best: 0,
      rankIndex: i,
      scores: finite,
    }),
  );
}

export function documentRunMetrics(documents: RankedDocument[]) {
  if (documents.length === 0) {
    return {
      documentsRanked: 0,
      topKDocuments: 0,
      confidenceMean: undefined as number | undefined,
      confidenceMax: undefined as number | undefined,
      scoreMargin: undefined as number | undefined,
    };
  }
  const confs = documents.map((d) => d.confidence);
  const mean = confs.reduce((a, b) => a + b, 0) / confs.length;
  const max = Math.max(...confs);
  // Margin on finalScore (retrieval signal), not on already-normalized conf
  const s0 = documents[0]?.finalScore ?? 0;
  const s1 = documents[1]?.finalScore ?? 0;
  const scoreMargin =
    documents.length === 1
      ? 0
      : s0 > 1e-12
        ? Math.max(0, (s0 - s1) / s0)
        : 0;
  return {
    documentsRanked: documents.length,
    topKDocuments: documents.length,
    confidenceMean: mean,
    confidenceMax: max,
    scoreMargin,
  };
}
