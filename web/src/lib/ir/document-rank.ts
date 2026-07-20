import type { RankedChunk, RankedDocument } from "./types";

/**
 * Aggregate chunk-level IR hits into document-level ranking.
 * Score = max(chunk finalScore); confidence = min-max normalize over topK.
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
  const confidences = normalizeConfidences(top.map((d) => d.finalScore));

  return top.map((doc, i) => ({
    documentId: doc.documentId,
    title: doc.title,
    finalScore: doc.finalScore,
    finalRank: i + 1,
    confidence: confidences[i] ?? 0,
    bm25Best: doc.bm25Best,
    denseBest: doc.hasDense ? doc.denseBest : undefined,
    chunkHits: doc.chunkHits,
    topChunkIds: doc.topChunkIds,
    snippet: doc.snippet,
  }));
}

/** Min-max to [0.15, 1] so the weakest top-k hit is still visible */
export function normalizeConfidences(scores: number[]): number[] {
  if (scores.length === 0) return [];
  const finite = scores.map((s) => (Number.isFinite(s) ? s : 0));
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  if (max - min < 1e-12) {
    return finite.map(() => 0.85);
  }
  return finite.map((s) => 0.15 + (0.85 * (s - min)) / (max - min));
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
  const top1 = confs[0] ?? 0;
  const top2 = confs[1] ?? 0;
  const scoreMargin = top1 > 0 ? (top1 - top2) / top1 : 0;
  return {
    documentsRanked: documents.length,
    topKDocuments: documents.length,
    confidenceMean: mean,
    confidenceMax: max,
    scoreMargin,
  };
}
