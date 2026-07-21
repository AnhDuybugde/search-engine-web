import { describe, expect, it } from "vitest";
import {
  DEFAULT_RETRIEVAL_MODE,
  isRetrievalModeId,
  parseRetrievalMode,
  RETRIEVAL_MODES,
  retrievalModeLabel,
} from "./retrieval-modes";

describe("retrieval-modes", () => {
  it("exposes paper and bm25 for UI switching", () => {
    const ids = RETRIEVAL_MODES.map((m) => m.id);
    expect(ids).toContain("paper");
    expect(ids).toContain("bm25");
    expect(ids).toContain("sgaf");
    expect(ids).not.toContain("adaptive_rrf");
    expect(DEFAULT_RETRIEVAL_MODE).toBe("paper");
  });

  it("validates and parses mode ids with adaptive aliases", () => {
    expect(isRetrievalModeId("bm25")).toBe(true);
    expect(isRetrievalModeId("paper")).toBe(true);
    expect(isRetrievalModeId("dense_only")).toBe(false);
    expect(parseRetrievalMode("bm25")).toBe("bm25");
    expect(parseRetrievalMode("paper")).toBe("paper");
    expect(parseRetrievalMode("adaptive_rrf")).toBe("paper");
    expect(parseRetrievalMode("adaptive")).toBe("paper");
    expect(parseRetrievalMode("nope", "bm25")).toBe("bm25");
    expect(parseRetrievalMode(undefined)).toBe(DEFAULT_RETRIEVAL_MODE);
  });

  it("labels known modes", () => {
    expect(retrievalModeLabel("paper")).toBe("Paper");
    expect(retrievalModeLabel("bm25")).toBe("BM25");
    expect(retrievalModeLabel("bm25_fallback")).toBe("BM25 fallback");
    expect(retrievalModeLabel("adaptive_rrf")).toContain("Paper");
  });
});
