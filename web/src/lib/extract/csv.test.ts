import { describe, expect, it } from "vitest";
import {
  detectCsvDelimiter,
  extractCsvText,
  isCsvFile,
  parseCsv,
} from "./csv";

describe("CSV extract (shipped upload path)", () => {
  it("detects common delimiters", () => {
    expect(detectCsvDelimiter("a,b,c")).toBe(",");
    expect(detectCsvDelimiter("a;b;c")).toBe(";");
    expect(detectCsvDelimiter("a\tb\tc")).toBe("\t");
  });

  it("parses quoted fields with commas", () => {
    const rows = parseCsv('name,city\n"Doe, Jane",Paris\nBob,Lyon');
    expect(rows[0]).toEqual(["name", "city"]);
    expect(rows[1][0]).toBe("Doe, Jane");
    expect(rows[1][1]).toBe("Paris");
  });

  it("formats labeled records for retrieval", () => {
    const csv = Buffer.from(
      "title,score,tag\nBM25 paper,0.9,ir\nDense retrieval,0.8,nlp\n",
      "utf-8",
    );
    const text = extractCsvText("papers.csv", csv, "text/csv");
    expect(text).toContain("CSV source: papers.csv");
    expect(text).toContain("title: BM25 paper");
    expect(text).toContain("score: 0.9");
    expect(text).toContain("Record 2");
    expect(text).toContain("Dense retrieval");
  });

  it("isCsvFile matches extensions and mime", () => {
    expect(isCsvFile("data.csv")).toBe(true);
    expect(isCsvFile("x.txt", "text/csv")).toBe(true);
    expect(isCsvFile("note.txt", "text/plain")).toBe(false);
  });
});
