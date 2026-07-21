import { describe, expect, it } from "vitest";
import type { RankedChunk, StreamEvent } from "@/lib/ir/types";
import {
  applySseEvent,
  finalizeSseOnStreamEnd,
  type SseState,
} from "./use-sse";

function chunk(
  id: string,
  documentId: string,
  score: number,
): RankedChunk {
  return {
    chunkId: id,
    documentId,
    title: `Title ${documentId}`,
    text: `body ${id}`,
    chunkIndex: 0,
    bm25Score: score,
    bm25Rank: 1,
    finalScore: score,
    finalRank: 1,
    citationId: 1,
  };
}

function baseState(partial?: Partial<SseState>): SseState {
  return {
    status: "running",
    answer: "",
    results: [],
    rankedChunks: [],
    documents: [],
    timing: null,
    metrics: null,
    error: null,
    logs: [],
    steps: {
      corpus: "success",
      query: "success",
      retrieve: "running",
      embedding: "pending",
      fusion: "pending",
      pack: "pending",
      generate: "pending",
      search: "pending",
      fetch: "pending",
      chunk: "pending",
    },
    ...partial,
  };
}

describe("applySseEvent ranked vs packed separation", () => {
  it("does not let retrieve_completed / run_completed wipe ranking hits with packed-only results", () => {
    const ranked = [
      chunk("c1", "d1", 3),
      chunk("c2", "d2", 2),
      chunk("c3", "d3", 1),
      chunk("c4", "d4", 0.5),
    ];
    const packed = [chunk("c1", "d1", 3)];

    let state = baseState();
    state = applySseEvent(state, {
      type: "rank_completed",
      documents: [
        {
          documentId: "d1",
          title: "Title d1",
          finalScore: 3,
          finalRank: 1,
          relativeScore: 1,
          confidence: 1,
          chunkHits: 1,
          topChunkIds: ["c1"],
        },
      ],
      chunks: ranked,
      ms: 12,
    });

    expect(state.rankedChunks).toHaveLength(4);
    expect(state.results).toHaveLength(0);

    state = applySseEvent(state, {
      type: "retrieve_completed",
      results: packed,
      ms: 15,
    });

    // packed evidence updated; ranking hits preserved for drawer
    expect(state.results).toHaveLength(1);
    expect(state.rankedChunks).toHaveLength(4);
    expect(state.rankedChunks.map((c) => c.chunkId)).toEqual([
      "c1",
      "c2",
      "c3",
      "c4",
    ]);

    state = applySseEvent(state, {
      type: "run_completed",
      answer: "ok",
      timing: { totalMs: 20, rankMs: 12 },
      metrics: {
        contextCount: 1,
        documentsRanked: 1,
        relativeScoreMax: 1,
        confidenceMax: 1,
        llmUsed: false,
        llmSkippedReason: "generateAnswer=false",
      },
      results: packed,
      rankedChunks: ranked,
      documents: [
        {
          documentId: "d1",
          title: "Title d1",
          finalScore: 3,
          finalRank: 1,
          relativeScore: 1,
          confidence: 1,
          chunkHits: 1,
          topChunkIds: ["c1"],
        },
      ],
    });

    expect(state.status).toBe("completed");
    expect(state.results).toHaveLength(1);
    expect(state.rankedChunks).toHaveLength(4);
    // Drawer can resolve per-hit scores for non-packed top docs
    const d4 = state.rankedChunks.find((c) => c.documentId === "d4");
    expect(d4?.bm25Score).toBe(0.5);
  });

  it("preserves previous rankedChunks if run_completed omits them (legacy web path)", () => {
    const ranked = [chunk("c1", "d1", 2), chunk("c2", "d2", 1)];
    let state = baseState({ rankedChunks: ranked, results: ranked });
    state = applySseEvent(state, {
      type: "run_completed",
      answer: "",
      timing: { totalMs: 5 },
      metrics: { llmUsed: false, llmSkippedReason: "generateAnswer=false" },
      results: [ranked[0]],
      // no rankedChunks field — must not collapse drawer data
    } as StreamEvent);

    expect(state.results).toHaveLength(1);
    expect(state.rankedChunks).toHaveLength(2);
  });
});

describe("finalizeSseOnStreamEnd (R3 terminal event)", () => {
  it("fails if stream ends while still running even when partial answer/results exist", () => {
    const prev = baseState({
      status: "running",
      answer: "partial streamed text",
      results: [chunk("c1", "d1", 1)],
    });
    const next = finalizeSseOnStreamEnd(prev);
    expect(next.status).toBe("failed");
    expect(next.error).toMatch(/without a completed answer/i);
    // Do not silently promote partial data to completed
    expect(next.answer).toBe("partial streamed text");
  });

  it("keeps completed status after run_completed (stream close is no-op)", () => {
    let state = baseState({ status: "running" });
    state = applySseEvent(state, {
      type: "run_completed",
      answer: "done",
      timing: { totalMs: 1 },
      metrics: { llmUsed: true },
      results: [chunk("c1", "d1", 1)],
    });
    expect(state.status).toBe("completed");
    const afterClose = finalizeSseOnStreamEnd(state);
    expect(afterClose.status).toBe("completed");
    expect(afterClose.answer).toBe("done");
  });
});
