import { IR_DEFAULTS } from "@/lib/config";
import type { RankedChunk, RankedDocument } from "./types";

/**
 * Document-level aggregation over unit hits using standard IR practices:
 *
 * Ranking score (per unit, already fused upstream):
 * - BM25-only mode → Okapi BM25 raw score
 * - Hybrid mode → classic Reciprocal Rank Fusion (RRF)
 *
 * Document pool: max over units (common max-pooling).
 *
 * `relativeScore` ∈ [0,1] is a **display-only** within-list normalization:
 *   score_i / max_j(score_j)
 * For a sole hybrid (RRF-scale) hit, temper with the dual-list RRF ceiling
 * 2/(k+1) so a weak lone hit is not painted as 100%.
 * Not a calibrated P(relevant) and not used for ranking order.
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
    hasBm25: boolean;
    chunkHits: number;
    topChunkIds: string[];
    snippet: string;
  };

  const byDoc = new Map<string, Agg>();

  for (const chunk of rankedChunks) {
    const score = Number.isFinite(chunk.finalScore)
      ? (chunk.finalScore as number)
      : chunk.bm25Score;
    const bm25 =
      Number.isFinite(chunk.bm25Score) && chunk.bm25Score > 0
        ? chunk.bm25Score
        : 0;
    const denseOk =
      chunk.denseScore != null && Number.isFinite(chunk.denseScore);
    const existing = byDoc.get(chunk.documentId);
    if (!existing) {
      byDoc.set(chunk.documentId, {
        documentId: chunk.documentId,
        title: chunk.title || "Untitled",
        finalScore: score,
        bm25Best: bm25,
        denseBest: denseOk
          ? (chunk.denseScore as number)
          : Number.NEGATIVE_INFINITY,
        hasDense: denseOk,
        hasBm25: bm25 > 0,
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
    if (bm25 > existing.bm25Best) {
      existing.bm25Best = bm25;
      existing.hasBm25 = true;
    }
    if (denseOk && (chunk.denseScore as number) > existing.denseBest) {
      existing.denseBest = chunk.denseScore as number;
      existing.hasDense = true;
    }
  }

  const sorted = [...byDoc.values()].sort(
    (a, b) => b.finalScore - a.finalScore,
  );
  const top = sorted.slice(0, topK);
  const scoreList = top.map((d) => d.finalScore);

  return top.map((doc, i) => {
    const relativeScore = relativeScoreFromList({
      finalScore: doc.finalScore,
      scores: scoreList,
    });
    return {
      documentId: doc.documentId,
      title: doc.title,
      finalScore: doc.finalScore,
      finalRank: i + 1,
      relativeScore,
      /** @deprecated use relativeScore — kept for older SSE clients */
      confidence: relativeScore,
      bm25Best: doc.hasBm25 && doc.bm25Best > 0 ? doc.bm25Best : undefined,
      denseBest: doc.hasDense ? doc.denseBest : undefined,
      chunkHits: doc.chunkHits,
      topChunkIds: doc.topChunkIds,
      snippet: doc.snippet,
    };
  });
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Math.min(1, Math.max(0, x));
}

/**
 * Classic dual-list RRF upper bound when a unit ranks #1 in both lists:
 *   1/(k+1) + 1/(k+1) = 2/(k+1)
 * (Cormack et al.; equal list weights.)
 */
export function rrfDualListCeiling(rrfK: number = IR_DEFAULTS.rrfK): number {
  const k = Number.isFinite(rrfK) && rrfK > 0 ? rrfK : 60;
  return 2 / (k + 1);
}

/**
 * Absolute strength of a rank score vs classic dual-list RRF ceiling 2/(k+1).
 * Use for “how strong is this hit?” — not the same as relative score/max.
 * BM25-only raw scores (≫ RRF range) return 1 (no universal BM25 ceiling).
 */
export function absoluteRankStrength(
  finalScore: number,
  rrfK: number = IR_DEFAULTS.rrfK,
): number {
  const fin = Number.isFinite(finalScore) && finalScore > 0 ? finalScore : 0;
  if (fin <= 0) return 0;
  const ceil = rrfDualListCeiling(rrfK);
  if (fin <= ceil * 1.25) return clamp01(fin / ceil);
  return 1;
}

/**
 * Standard within-query relative score for UI bars: score_i / max(scores).
 * Multi-list #1 is always 1.0 by definition — use absoluteRankStrength for
 * absolute hybrid quality of the top hit.
 */
export function relativeScoreFromList(opts: {
  finalScore: number;
  scores: number[];
  rrfK?: number;
}): number {
  const fin =
    Number.isFinite(opts.finalScore) && opts.finalScore > 0
      ? opts.finalScore
      : 0;
  const scores = opts.scores
    .map((s) => (Number.isFinite(s) && s > 0 ? s : 0))
    .filter((s) => s > 0);

  if (fin <= 0 || scores.length === 0) return 0;

  const top = Math.max(...scores);
  if (top <= 0) return 0;

  const relative = clamp01(fin / top);

  // Sole hit on RRF scale → absolute fraction of dual-list ceiling
  if (scores.length === 1) {
    return absoluteRankStrength(fin, opts.rrfK ?? IR_DEFAULTS.rrfK);
  }

  return relative;
}

/** @deprecated Prefer relativeScoreFromList */
export function relativeRelevance(opts: {
  finalScore: number;
  scores: number[];
  rrfK?: number;
}): number {
  return relativeScoreFromList(opts);
}

/** @deprecated Prefer relativeScoreFromList */
export function documentConfidence(opts: {
  finalScore: number;
  bm25Best?: number;
  denseBest?: number;
  rankIndex?: number;
  scores: number[];
  rrfK?: number;
}): number {
  return relativeScoreFromList({
    finalScore: opts.finalScore,
    scores: opts.scores,
    rrfK: opts.rrfK,
  });
}

/** Normalize scores to relative strengths (score / max). */
export function normalizeRelativeScores(scores: number[]): number[] {
  if (scores.length === 0) return [];
  const finite = scores.map((s) => (Number.isFinite(s) ? s : 0));
  return finite.map((s) =>
    relativeScoreFromList({
      finalScore: s,
      scores: finite,
    }),
  );
}

/** @deprecated Prefer normalizeRelativeScores */
export function normalizeConfidences(scores: number[]): number[] {
  return normalizeRelativeScores(scores);
}

export function documentRunMetrics(documents: RankedDocument[]) {
  if (documents.length === 0) {
    return {
      documentsRanked: 0,
      topKDocuments: 0,
      /** Absolute hybrid strength of #1 vs RRF ceiling (not always 100%). */
      topScoreStrength: undefined as number | undefined,
      relativeScoreMean: undefined as number | undefined,
      relativeScoreMax: undefined as number | undefined,
      /** @deprecated use relativeScoreMean */
      confidenceMean: undefined as number | undefined,
      /**
       * Absolute top strength (preferred). Kept on confidenceMax so older UI
       * that showed “top match %” is not stuck at always-100% relative max.
       */
      confidenceMax: undefined as number | undefined,
      /** (top1 − top2) / top1 on rank score — standard score margin */
      scoreMargin: undefined as number | undefined,
    };
  }
  const rels = documents.map((d) => d.relativeScore ?? d.confidence ?? 0);
  const mean = rels.reduce((a, b) => a + b, 0) / rels.length;
  const max = Math.max(...rels);
  const s0 = documents[0]?.finalScore ?? 0;
  const s1 = documents[1]?.finalScore ?? 0;
  const topScoreStrength = absoluteRankStrength(s0);
  const scoreMargin =
    documents.length === 1
      ? 0
      : s0 > 1e-12
        ? Math.max(0, (s0 - s1) / s0)
        : 0;
  return {
    documentsRanked: documents.length,
    topKDocuments: documents.length,
    topScoreStrength,
    relativeScoreMean: mean,
    relativeScoreMax: max,
    confidenceMean: mean,
    // Prefer absolute top strength over relative max (which is always 1 multi)
    confidenceMax: topScoreStrength,
    scoreMargin,
  };
}
