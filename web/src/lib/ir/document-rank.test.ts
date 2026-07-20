import { describe, expect, it } from "vitest";
import {
  documentRunMetrics,
  normalizeConfidences,
  rankDocumentsFromChunks,
} from "./document-rank";
import type { RankedChunk } from "./types";

function chunk(input: {
  chunkId: string;
  documentId: string;
  finalScore: number;
  title?: string;
  text?: string;
  chunkIndex?: number;
  bm25Score?: number;
  bm25Rank?: number;
  finalRank?: number;
  citationId?: number;
}): RankedChunk {
  return {
    chunkId: input.chunkId,
    documentId: input.documentId,
    title: input.title || `Doc ${input.documentId}`,
    text: input.text || "body",
    chunkIndex: input.chunkIndex ?? 0,
    bm25Score: input.bm25Score ?? input.finalScore,
    bm25Rank: input.bm25Rank ?? 1,
    finalScore: input.finalScore,
    finalRank: input.finalRank ?? 1,
    citationId: input.citationId ?? 1,
  };
}

describe("rankDocumentsFromChunks", () => {
  it("aggregates by document and returns top K titles", () => {
    const ranked = rankDocumentsFromChunks(
      [
        chunk({
          chunkId: "c1",
          documentId: "d1",
          title: "Alpha",
          finalScore: 0.9,
        }),
        chunk({
          chunkId: "c2",
          documentId: "d1",
          title: "Alpha",
          finalScore: 0.4,
        }),
        chunk({
          chunkId: "c3",
          documentId: "d2",
          title: "Beta",
          finalScore: 0.7,
        }),
        chunk({
          chunkId: "c4",
          documentId: "d3",
          title: "Gamma",
          finalScore: 0.2,
        }),
      ],
      2,
    );

    expect(ranked).toHaveLength(2);
    expect(ranked[0].documentId).toBe("d1");
    expect(ranked[0].title).toBe("Alpha");
    expect(ranked[0].finalScore).toBe(0.9);
    expect(ranked[0].chunkHits).toBe(2);
    expect(ranked[0].finalRank).toBe(1);
    expect(ranked[1].documentId).toBe("d2");
    expect(ranked[0].confidence).toBeGreaterThan(ranked[1].confidence);
  });

  it("normalizeConfidences maps equal scores to mid-high", () => {
    expect(normalizeConfidences([1, 1, 1])).toEqual([0.85, 0.85, 0.85]);
  });

  it("documentRunMetrics computes margin", () => {
    const docs = rankDocumentsFromChunks(
      [
        chunk({ chunkId: "a", documentId: "1", finalScore: 10 }),
        chunk({ chunkId: "b", documentId: "2", finalScore: 5 }),
      ],
      10,
    );
    const m = documentRunMetrics(docs);
    expect(m.documentsRanked).toBe(2);
    expect(m.scoreMargin).toBeGreaterThan(0);
    expect(m.confidenceMax).toBeDefined();
  });
});
