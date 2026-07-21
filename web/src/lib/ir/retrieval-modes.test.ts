import { describe, expect, it } from "vitest";
import {
  DEFAULT_RETRIEVAL_MODE,
  isRetrievalModeId,
  parseRetrievalMode,
  RETRIEVAL_MODES,
  retrievalModeLabel,
} from "./retrieval-modes";

describe("retrieval-modes registry", () => {
  it("exposes adaptive_rrf and bm25 for UI switching", () => {
    const ids = RETRIEVAL_MODES.map((m) => m.id);
    expect(ids).toContain("adaptive_rrf");
    expect(ids).toContain("bm25");
    expect(DEFAULT_RETRIEVAL_MODE).toBe("adaptive_rrf");
  });

  it("parses known modes and falls back safely", () => {
    expect(isRetrievalModeId("bm25")).toBe(true);
    expect(isRetrievalModeId("dense_only")).toBe(false);
    expect(parseRetrievalMode("bm25")).toBe("bm25");
    expect(parseRetrievalMode("nope", "bm25")).toBe("bm25");
    expect(parseRetrievalMode(undefined)).toBe(DEFAULT_RETRIEVAL_MODE);
  });

  it("labels modes for metrics UI", () => {
    expect(retrievalModeLabel("adaptive_rrf")).toBe("Adaptive");
    expect(retrievalModeLabel("bm25")).toBe("BM25");
    expect(retrievalModeLabel("bm25_fallback")).toBe("BM25 fallback");
  });
});
