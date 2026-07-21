import { describe, expect, it } from "vitest";
import { expandRawSourceToUnits } from "./raw-units";
import { extractCsvText } from "@/lib/extract/csv";

describe("query-time raw unit expansion", () => {
  it("splits multi-record CSV extract into separate claim units", () => {
    const buf = Buffer.from(
      [
        "id,claim,tag",
        "1,Vitamins A and D regulate calcium absorption,nutrition",
        "2,Melanoma responds to PD-1 blockade,oncology",
        "3,Severe mental disorder needs inpatient care,psych",
      ].join("\n"),
      "utf-8",
    );
    const stored = extractCsvText("claims_test.csv", buf, "text/csv");
    const units = expandRawSourceToUnits({
      id: "src-csv",
      title: "claims_test.csv",
      text: stored,
      mime: "text/plain",
    });

    expect(units.length).toBeGreaterThanOrEqual(3);
    // Each unit is its own document for ranking cards
    expect(new Set(units.map((u) => u.documentId)).size).toBe(units.length);
    const vit = units.find((u) => /vitamin/i.test(u.text));
    expect(vit).toBeTruthy();
    expect(vit!.text.length).toBeLessThan(stored.length / 2);
    expect(vit!.embedding).toBeNull();
    expect(vit!.chunkId).toMatch(/^raw-src-csv-r/);
  });

  it("keeps short single docs as one unit", () => {
    const units = expandRawSourceToUnits({
      id: "s1",
      title: "note.txt",
      text: "BM25 is a ranking function for lexical retrieval.",
    });
    expect(units).toHaveLength(1);
    expect(units[0].documentId).toBe("s1");
  });

  it("splits long prose into multiple parts", () => {
    const para = (n: number) =>
      `Paragraph ${n}. ` +
      "This is a reasonably long sentence about scientific retrieval and ranking methods. ".repeat(
        8,
      );
    const text = [para(1), para(2), para(3), para(4)].join("\n\n");
    expect(text.length).toBeGreaterThan(1200);
    const units = expandRawSourceToUnits({
      id: "long",
      title: "paper.txt",
      text,
    });
    expect(units.length).toBeGreaterThanOrEqual(2);
    expect(units.every((u) => u.embedding === null)).toBe(true);
  });
});
