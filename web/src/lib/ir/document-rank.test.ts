import { describe, expect, it } from "vitest";
import {
  documentConfidence,
  documentRunMetrics,
  normalizeConfidences,
  rankDocumentsFromChunks,
  relativeRelevance,
  rrfDualListCeiling,
} from "./document-rank";
import type { RankedChunk } from "./types";
import { runNotebookAskPipeline } from "@/lib/pipeline/notebook-ask";
import type { ChunkWithEmbedding } from "./types";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const SCRATCH =
  process.env.CONFIDENCE_SCRATCH ||
  "/tmp/grok-goal-aaf454b4b9ce/implementer";

function chunk(input: {
  chunkId: string;
  documentId: string;
  finalScore: number;
  title?: string;
  text?: string;
  chunkIndex?: number;
  bm25Score?: number;
  bm25Rank?: number;
  denseScore?: number;
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
    denseScore: input.denseScore,
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
          bm25Score: 8,
        }),
        chunk({
          chunkId: "c2",
          documentId: "d1",
          title: "Alpha",
          finalScore: 0.4,
          bm25Score: 2,
        }),
        chunk({
          chunkId: "c3",
          documentId: "d2",
          title: "Beta",
          finalScore: 0.7,
          bm25Score: 5,
        }),
        chunk({
          chunkId: "c4",
          documentId: "d3",
          title: "Gamma",
          finalScore: 0.2,
          bm25Score: 1,
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
    // Relative: top = 1.0, second = 0.7/0.9
    expect(ranked[0].relativeScore).toBeCloseTo(1, 5);
    expect(ranked[1].relativeScore).toBeCloseTo(0.7 / 0.9, 5);
  });

  it("stronger finalScore yields higher relative strength in multi-doc ranking", () => {
    const ranked = rankDocumentsFromChunks(
      [
        chunk({
          chunkId: "strong",
          documentId: "strong-doc",
          finalScore: 0.08,
          bm25Score: 6.5,
          denseScore: 0.7,
        }),
        chunk({
          chunkId: "weak",
          documentId: "weak-doc",
          finalScore: 0.01,
          bm25Score: 0.4,
          denseScore: 0.1,
        }),
      ],
      10,
    );
    expect(ranked[0].documentId).toBe("strong-doc");
    expect(ranked[0].relativeScore).toBeCloseTo(1, 5);
    expect(ranked[1].relativeScore).toBeCloseTo(0.01 / 0.08, 5);
  });

  it("equal scores all get relative 1.0 (tied for best)", () => {
    const weakEqual = normalizeConfidences([0.001, 0.001, 0.001]);
    const strongEqual = rankDocumentsFromChunks(
      [
        chunk({
          chunkId: "a",
          documentId: "1",
          finalScore: 0.05,
          bm25Score: 9,
        }),
        chunk({
          chunkId: "b",
          documentId: "2",
          finalScore: 0.05,
          bm25Score: 9,
        }),
      ],
      10,
    );
    // Multi equal → all relative 1.0
    expect(weakEqual.every((c) => c === 1)).toBe(true);
    expect(strongEqual[0].relativeScore).toBeCloseTo(1, 5);
    expect(strongEqual[1].relativeScore).toBeCloseTo(1, 5);
  });

  it("single weak RRF hit is tempered by dual-list ceiling (not 100%)", () => {
    const weak = rankDocumentsFromChunks(
      [
        chunk({
          chunkId: "only",
          documentId: "solo",
          finalScore: 0.008,
          bm25Score: 0.3,
          denseScore: 0.1,
        }),
      ],
      10,
    );
    const ceil = rrfDualListCeiling();
    expect(weak).toHaveLength(1);
    expect(weak[0].relativeScore).toBeCloseTo(0.008 / ceil, 5);
    expect(weak[0].relativeScore).toBeLessThan(0.5);
    expect(Math.abs(weak[0].relativeScore - 0.85)).toBeGreaterThan(0.2);
  });

  it("single strong near-ceiling RRF hit gets high relative strength", () => {
    const ceil = rrfDualListCeiling();
    const strong = rankDocumentsFromChunks(
      [
        chunk({
          chunkId: "only",
          documentId: "solo",
          finalScore: ceil * 0.95,
          bm25Score: 12,
          denseScore: 0.85,
        }),
      ],
      10,
    );
    expect(strong[0].relativeScore).toBeCloseTo(0.95, 5);
    expect(strong[0].relativeScore).toBeGreaterThan(0.9);
  });

  it("omits non-positive BM25 for dense-only hits", () => {
    const ranked = rankDocumentsFromChunks(
      [
        chunk({
          chunkId: "d",
          documentId: "dense-only",
          finalScore: 0.016,
          bm25Score: 0,
          denseScore: 0.72,
        }),
      ],
      10,
    );
    expect(ranked[0].bm25Best).toBeUndefined();
    expect(ranked[0].denseBest).toBeCloseTo(0.72, 5);
  });

  it("documentRunMetrics uses score margin and absolute top strength", () => {
    const docs = rankDocumentsFromChunks(
      [
        chunk({ chunkId: "a", documentId: "1", finalScore: 10, bm25Score: 10 }),
        chunk({ chunkId: "b", documentId: "2", finalScore: 5, bm25Score: 5 }),
      ],
      10,
    );
    const m = documentRunMetrics(docs);
    expect(m.documentsRanked).toBe(2);
    expect(m.scoreMargin).toBeCloseTo(0.5, 5);
    // multi-list relative max is always 1; absolute top strength is separate
    expect(m.relativeScoreMax).toBeCloseTo(1, 5);
    expect(m.topScoreStrength).toBe(1); // BM25-scale raw
    expect(m.relativeScoreMean).toBeCloseTo(
      (docs[0].relativeScore + docs[1].relativeScore) / 2,
      5,
    );

    const hybrid = rankDocumentsFromChunks(
      [
        chunk({
          chunkId: "h1",
          documentId: "t",
          finalScore: rrfDualListCeiling() * 0.5,
          bm25Score: 3,
          denseScore: 0.4,
        }),
        chunk({
          chunkId: "h2",
          documentId: "u",
          finalScore: rrfDualListCeiling() * 0.25,
          bm25Score: 1,
          denseScore: 0.2,
        }),
      ],
      10,
    );
    const hm = documentRunMetrics(hybrid);
    expect(hm.relativeScoreMax).toBeCloseTo(1, 5);
    expect(hm.topScoreStrength).toBeCloseTo(0.5, 5);
    expect(hm.confidenceMax).toBeCloseTo(0.5, 5);
  });

  it("relativeRelevance is score/max for multi and ceiling for sole RRF", () => {
    const multi = relativeRelevance({
      finalScore: 0.02,
      scores: [0.04, 0.02],
    });
    expect(multi).toBeCloseTo(0.5, 5);

    const sole = relativeRelevance({
      finalScore: 0.016393, // ≈ 1/61
      scores: [0.016393],
      rrfK: 60,
    });
    expect(sole).toBeCloseTo(0.016393 / rrfDualListCeiling(60), 4);
  });

  it("documentConfidence alias matches relativeRelevance", () => {
    const a = documentConfidence({
      finalScore: 0.03,
      scores: [0.06, 0.03],
    });
    const b = relativeRelevance({
      finalScore: 0.03,
      scores: [0.06, 0.03],
    });
    expect(a).toBe(b);
  });
});

describe("relative score via shipped ask pipeline", () => {
  it("derives confidenceMax from ranked scores for a discriminative query", async () => {
    mkdirSync(SCRATCH, { recursive: true });
    process.env.RETRIEVAL_MODE = "bm25";

    const chunks: ChunkWithEmbedding[] = [
      {
        chunkId: "raw-a",
        documentId: "doc-bm25-paper",
        title: "BM25 ranking paper",
        text: "BM25 is a probabilistic bag-of-words ranking function for lexical retrieval in search engines and IR evaluation.",
        chunkIndex: 0,
        embedding: null,
      },
      {
        chunkId: "raw-b",
        documentId: "doc-plants",
        title: "Plant biology notes",
        text: "Chloroplast genomes encode proteins involved in photosynthesis pathways and leaf structure.",
        chunkIndex: 0,
        embedding: null,
      },
      {
        chunkId: "raw-c",
        documentId: "doc-cooking",
        title: "Cooking tips",
        text: "Simmer the sauce gently and season with salt after reducing.",
        chunkIndex: 0,
        embedding: null,
      },
    ];

    const result = await runNotebookAskPipeline(
      {
        query: "BM25 lexical ranking function for retrieval",
        chunks,
        documentTopK: 10,
        retrieveTopK: 10,
        contextTopK: 2,
        generateAnswer: false,
      },
      () => {},
    );

    expect(result.documents.length).toBeGreaterThan(0);
    expect(result.documents[0].documentId).toBe("doc-bm25-paper");
    expect(result.documents[0].relativeScore).toBeTypeOf("number");
    expect(result.documents[0].relativeScore).toBeGreaterThan(0);
    expect(result.documents[0].relativeScore).toBeLessThanOrEqual(1);
    // Top of multi-list always relative 1.0 under score/max
    if (result.documents.length > 1) {
      expect(result.documents[0].relativeScore).toBeCloseTo(1, 5);
      const top = result.documents[0].finalScore;
      for (const d of result.documents) {
        expect(d.relativeScore).toBeCloseTo(
          top > 0 ? d.finalScore / top : 0,
          5,
        );
      }
    }
    expect(result.metrics.relativeScoreMax).toBeCloseTo(1, 5);
    expect(result.metrics.topScoreStrength).toBeTypeOf("number");
    expect(result.metrics.relativeScoreMean).toBeTypeOf("number");

    const summary = {
      topDocumentId: result.documents[0].documentId,
      topTitle: result.documents[0].title,
      topFinalScore: result.documents[0].finalScore,
      topConfidence: result.documents[0].relativeScore,
      confidenceMax: result.metrics.relativeScoreMax,
      confidenceMean: result.metrics.relativeScoreMean,
      scoreMargin: result.metrics.scoreMargin,
      documents: result.documents.map((d) => ({
        id: d.documentId,
        score: d.finalScore,
        conf: d.relativeScore,
        bm25: d.bm25Best,
      })),
    };
    writeFileSync(
      path.join(SCRATCH, "confidence-ask-sample.json"),
      JSON.stringify(summary, null, 2),
    );
  });
});
