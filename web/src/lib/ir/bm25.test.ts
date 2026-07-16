import { describe, expect, it } from "vitest";
import { bm25Retrieve, tokenize } from "./bm25";
import { chunkDocument } from "./chunker";
import { packContext } from "./packer";

describe("tokenize", () => {
  it("lowercases and splits", () => {
    expect(tokenize("Hello, World!")).toEqual(["hello", "world"]);
  });
});

describe("bm25Retrieve", () => {
  it("ranks relevant chunk higher", () => {
    const chunks = [
      {
        chunkId: "1",
        documentId: "a",
        title: "A",
        text: "cats and dogs are animals",
        chunkIndex: 0,
      },
      {
        chunkId: "2",
        documentId: "b",
        title: "B",
        text: "quantum computing uses qubits and superposition",
        chunkIndex: 0,
      },
    ];
    const ranked = bm25Retrieve("quantum qubits", chunks, 2);
    expect(ranked[0].chunkId).toBe("2");
    expect(ranked[0].citationId).toBe(1);
  });
});

describe("chunk + pack", () => {
  it("chunks long text and packs with diversity", () => {
    const words = Array.from({ length: 800 }, (_, i) => `word${i % 50}`).join(" ");
    const chunks = chunkDocument({
      documentId: "d1",
      title: "Doc",
      url: "https://example.com/a",
      text: words,
    });
    expect(chunks.length).toBeGreaterThan(1);

    const fakeRanked = chunks.slice(0, 10).map((c, i) => ({
      ...c,
      bm25Score: 10 - i,
      bm25Rank: i + 1,
      finalRank: i + 1,
      citationId: i + 1,
    }));
    const packed = packContext(fakeRanked, 4, 2);
    expect(packed.length).toBeLessThanOrEqual(4);
    expect(packed[0].citationId).toBe(1);
  });
});
