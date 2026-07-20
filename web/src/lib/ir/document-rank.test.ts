import { describe, expect, it } from "vitest";
import {
  documentConfidence,
  documentRunMetrics,
  normalizeConfidences,
  rankDocumentsFromChunks,
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
    expect(ranked[0].confidence).toBeGreaterThan(ranked[1].confidence);
    expect(ranked[0].confidence).toBeGreaterThan(0);
    expect(ranked[0].confidence).toBeLessThanOrEqual(1);
  });

  it("stronger finalScore yields higher confidence in multi-doc ranking", () => {
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
    expect(ranked[0].confidence).toBeGreaterThan(ranked[1].confidence);
    expect(ranked[0].confidence).toBeGreaterThan(0.4);
    expect(ranked[1].confidence).toBeLessThan(ranked[0].confidence);
  });

  it("equal scores do not hardcode 0.85; depend on absolute strength", () => {
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
    // Old bug: always 0.85 for equal scores
    expect(weakEqual.every((c) => Math.abs(c - 0.85) > 0.05)).toBe(true);
    expect(weakEqual[0]).toBeLessThan(0.5);
    expect(strongEqual[0].confidence).toBeGreaterThan(weakEqual[0]);
    expect(strongEqual[0].confidence).toBeCloseTo(strongEqual[1].confidence, 5);
  });

  it("single weak document is not shown as ~85% confidence", () => {
    const weak = rankDocumentsFromChunks(
      [
        chunk({
          chunkId: "only",
          documentId: "solo",
          finalScore: 0.021,
          bm25Score: 0.3,
          denseScore: 0.1,
        }),
      ],
      10,
    );
    expect(weak).toHaveLength(1);
    expect(weak[0].confidence).toBeLessThan(0.45);
    expect(weak[0].confidence).toBeGreaterThan(0.04);
    // Explicitly reject the old constant
    expect(Math.abs(weak[0].confidence - 0.85)).toBeGreaterThan(0.2);
  });

  it("single strong document gets high confidence without needing competitors", () => {
    const strong = rankDocumentsFromChunks(
      [
        chunk({
          chunkId: "only",
          documentId: "solo",
          finalScore: 0.09,
          bm25Score: 12,
          denseScore: 0.85,
        }),
      ],
      10,
    );
    expect(strong[0].confidence).toBeGreaterThan(0.55);
  });

  it("documentRunMetrics uses score margin from finalScore", () => {
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
    expect(m.confidenceMax).toBe(docs[0].confidence);
    expect(m.confidenceMean).toBeCloseTo(
      (docs[0].confidence + docs[1].confidence) / 2,
      5,
    );
  });

  it("documentConfidence is in (0,1] and increases with BM25 strength", () => {
    const low = documentConfidence({
      finalScore: 0.01,
      bm25Best: 0.2,
      rankIndex: 0,
      scores: [0.01],
    });
    const high = documentConfidence({
      finalScore: 0.08,
      bm25Best: 8,
      rankIndex: 0,
      scores: [0.08],
    });
    expect(low).toBeGreaterThan(0);
    expect(low).toBeLessThanOrEqual(1);
    expect(high).toBeGreaterThan(low);
  });
});

describe("confidence via shipped ask pipeline", () => {
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
    expect(result.documents[0].confidence).toBeTypeOf("number");
    expect(result.documents[0].confidence).toBeGreaterThan(0);
    expect(result.documents[0].confidence).toBeLessThanOrEqual(1);
    expect(result.metrics.confidenceMax).toBe(result.documents[0].confidence);
    expect(result.metrics.confidenceMean).toBeTypeOf("number");

    // Strong lexical match should not look like the old fixed 0.85 single-hit case
    // (multi-doc ranking with a clear winner → real derived value)
    if (result.documents.length === 1) {
      expect(Math.abs(result.documents[0].confidence - 0.85)).toBeGreaterThan(
        0.01,
      );
    }

    const summary = {
      topDocumentId: result.documents[0].documentId,
      topTitle: result.documents[0].title,
      topFinalScore: result.documents[0].finalScore,
      topConfidence: result.documents[0].confidence,
      confidenceMax: result.metrics.confidenceMax,
      confidenceMean: result.metrics.confidenceMean,
      scoreMargin: result.metrics.scoreMargin,
      documents: result.documents.map((d) => ({
        id: d.documentId,
        score: d.finalScore,
        conf: d.confidence,
        bm25: d.bm25Best,
      })),
    };
    writeFileSync(
      path.join(SCRATCH, "confidence-ask-sample.json"),
      JSON.stringify(summary, null, 2),
    );
  });
});
