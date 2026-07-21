import { describe, expect, it } from "vitest";
import type { ChunkWithEmbedding, StreamEvent } from "@/lib/ir/types";
import { runNotebookAskPipeline } from "./notebook-ask";

function makeChunks(): ChunkWithEmbedding[] {
  return [
    {
      chunkId: "c1",
      documentId: "doc-alpha",
      title: "Alpha paper on transformers",
      text: "Transformers use self-attention for sequence modeling in NLP and IR.",
      chunkIndex: 0,
    },
    {
      chunkId: "c2",
      documentId: "doc-beta",
      title: "Beta survey of BM25",
      text: "BM25 is a probabilistic bag-of-words ranking function for lexical retrieval.",
      chunkIndex: 0,
    },
    {
      chunkId: "c3",
      documentId: "doc-gamma",
      title: "Gamma notes on hybrid search",
      text: "Hybrid search combines BM25 lexical scores with dense embedding similarity.",
      chunkIndex: 0,
    },
    {
      chunkId: "c4",
      documentId: "doc-alpha",
      title: "Alpha paper on transformers",
      text: "Attention mechanisms allow models to weigh token relevance dynamically.",
      chunkIndex: 1,
    },
  ];
}

describe("runNotebookAskPipeline (shipped entry)", () => {
  it("emits timings, confidence metrics, and top documents for a real query", async () => {
    const events: StreamEvent[] = [];
    const result = await runNotebookAskPipeline(
      {
        query: "BM25 lexical ranking function",
        chunks: makeChunks(),
        documentTopK: 10,
        retrieveTopK: 20,
        contextTopK: 3,
        generateAnswer: false,
      },
      (e) => events.push(e),
    );

    expect(result.timing.totalMs).toBeTypeOf("number");
    expect(result.timing.totalMs).toBeGreaterThanOrEqual(0);
    expect(
      result.timing.rankMs ?? result.timing.retrieveMs,
    ).toBeTypeOf("number");
    expect(result.timing.queryProcessMs).toBeTypeOf("number");
    expect(result.timing.bm25Ms).toBeTypeOf("number");

    expect(result.documents.length).toBeGreaterThan(0);
    expect(result.documents.length).toBeLessThanOrEqual(10);
    expect(result.documents[0].finalRank).toBe(1);
    expect(result.documents[0].title.length).toBeGreaterThan(0);
    expect(result.documents[0].confidence).toBeGreaterThan(0);
    expect(result.documents[0].confidence).toBeLessThanOrEqual(1);

    expect(result.metrics.confidenceMax).toBeTypeOf("number");
    expect(result.metrics.documentsRanked).toBe(result.documents.length);
    expect(result.metrics.llmUsed).toBe(false);

    const types = events.map((e) => e.type);
    expect(types).toContain("query_started");
    expect(types).toContain("rank_completed");
    expect(types).toContain("run_completed");

    const rankEv = events.find((e) => e.type === "rank_completed");
    expect(rankEv && rankEv.type === "rank_completed" && rankEv.documents.length).toBeTruthy();

    // Top doc for this query should prefer BM25 paper when lexical matches
    const titles = result.documents.map((d) => d.title.toLowerCase());
    expect(titles.some((t) => t.includes("bm25") || t.includes("hybrid"))).toBe(
      true,
    );
  });

  it("keeps rankedChunks broader than packed results for drawer score breakdown", async () => {
    const events: StreamEvent[] = [];
    const result = await runNotebookAskPipeline(
      {
        query: "BM25 lexical ranking function",
        chunks: makeChunks(),
        documentTopK: 10,
        retrieveTopK: 20,
        contextTopK: 1, // pack collapses hard; ranking must stay wider
        generateAnswer: false,
      },
      (e) => events.push(e),
    );

    expect(result.results.length).toBeLessThanOrEqual(1);
    expect(result.rankedChunks.length).toBeGreaterThan(result.results.length);

    const completed = events.find((e) => e.type === "run_completed");
    expect(completed?.type).toBe("run_completed");
    if (completed?.type !== "run_completed") throw new Error("missing run_completed");
    expect(completed.rankedChunks?.length).toBe(result.rankedChunks.length);
    expect(completed.results.length).toBe(result.results.length);
    // drawer needs scores for ranked hits, not only packed
    expect(result.rankedChunks.every((c) => Number.isFinite(c.bm25Score))).toBe(
      true,
    );
  });
});
