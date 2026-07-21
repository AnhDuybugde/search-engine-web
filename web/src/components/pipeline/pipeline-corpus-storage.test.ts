import { describe, expect, it } from "vitest";
import { describeNotebookCorpusStorage } from "./PipelineInspector";

describe("describeNotebookCorpusStorage (shipped corpus Storage label)", () => {
  it("labels durable raw store even when query-time retrieval units > 0", () => {
    // Mirrors DatasetChatLayout after a successful ask on a raw notebook:
    // sourceCount = stored sources, retrievalUnitCount = metrics.chunkCount.
    const result = describeNotebookCorpusStorage({
      sourceCount: 400,
      retrievalUnitCount: 40,
    });

    expect(result.storage).toBe(
      "Raw full text only (0 stored chunks, 0 embeddings)",
    );
    expect(result.storage).not.toMatch(/legacy|stored chunk rows/i);

    const byKey = Object.fromEntries(result.rows.map((r) => [r.k, r.v]));
    expect(byKey["Stored sources"]).toBe("400");
    expect(byKey["Storage"]).toBe(
      "Raw full text only (0 stored chunks, 0 embeddings)",
    );
    expect(byKey["Retrieval units (this run)"]).toBe("40");
  });

  it("does not treat retrievalUnitCount alone as stored chunks", () => {
    const onlyUnits = describeNotebookCorpusStorage({
      retrievalUnitCount: 12,
    });
    expect(onlyUnits.storage).toBe("No sources yet");
    expect(onlyUnits.storage).not.toMatch(/legacy|mixed/i);
    expect(
      onlyUnits.rows.find((r) => r.k === "Retrieval units (this run)")?.v,
    ).toBe("12");
  });

  it("raw sources with zero query units still report raw storage", () => {
    const idle = describeNotebookCorpusStorage({
      sourceCount: 5,
      retrievalUnitCount: 0,
    });
    expect(idle.storage).toContain("Raw full text only");
    expect(
      idle.rows.find((r) => r.k === "Retrieval units (this run)"),
    ).toBeUndefined();
  });

  it("empty notebook", () => {
    const empty = describeNotebookCorpusStorage({ sourceCount: 0 });
    expect(empty.storage).toBe("No sources yet");
  });
});
