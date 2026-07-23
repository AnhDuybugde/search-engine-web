import { describe, expect, it } from "vitest";
import {
  classifyScholarlySource,
  filterScholarlySources,
} from "./scholarly-sources";

describe("public scholarly source policy", () => {
  it("accepts public paper and publication-record URLs", () => {
    expect(classifyScholarlySource("https://pubmed.ncbi.nlm.nih.gov/123456/").accepted).toBe(true);
    expect(classifyScholarlySource("https://arxiv.org/abs/2401.12345").kind).toBe("preprint");
    expect(classifyScholarlySource("https://doi.org/10.1234/example").accepted).toBe(true);
    expect(classifyScholarlySource("https://www.nature.com/articles/s41586-024-00001-1").accepted).toBe(true);
    expect(classifyScholarlySource("https://www.ncbi.nlm.nih.gov/gene/123").accepted).toBe(false);
  });

  it("rejects non-scholarly and ambiguous pages", () => {
    expect(classifyScholarlySource("https://en.wikipedia.org/wiki/Research").accepted).toBe(false);
    expect(classifyScholarlySource("https://www.researchgate.net/publication/123").accepted).toBe(false);
    expect(classifyScholarlySource("https://www.nature.com/").accepted).toBe(false);
    expect(classifyScholarlySource("https://example.edu/lab/blog").accepted).toBe(false);
    expect(classifyScholarlySource("https://www.nature.com/news/science-news").accepted).toBe(false);
  });

  it("filters before retrieval so rejected pages cannot reach the LLM", () => {
    const accepted = filterScholarlySources([
      { title: "Paper", url: "https://arxiv.org/abs/2401.12345", snippet: "evidence" },
      { title: "Blog", url: "https://example.com/blog/paper", snippet: "noise" },
    ]);
    expect(accepted).toHaveLength(1);
    expect(accepted[0].title).toBe("Paper");
  });
});
