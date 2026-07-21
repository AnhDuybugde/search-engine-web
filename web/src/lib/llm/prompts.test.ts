import { describe, expect, it } from "vitest";
import {
  buildCitationSystemPrompt,
  buildCitationUserPrompt,
} from "./prompts";
import type { RankedChunk } from "@/lib/ir/types";

function chunk(partial: Partial<RankedChunk> & { text: string }): RankedChunk {
  return {
    chunkId: partial.chunkId || "c1",
    documentId: partial.documentId || "d1",
    title: partial.title || "claims_test.csv",
    text: partial.text,
    chunkIndex: 0,
    bm25Score: 1,
    bm25Rank: 1,
    finalRank: 1,
    citationId: partial.citationId || 1,
  };
}

describe("citation prompts English-only product (shipped)", () => {
  it("system prompt always requires English answers", () => {
    const system = buildCitationSystemPrompt(
      "what the name of dataset having in the database now?",
    );
    expect(system).toMatch(/English only/i);
    expect(system).toMatch(/Do not answer in Vietnamese/i);
    // No bilingual preference / positive VN answer instruction
    expect(system).not.toMatch(/Prefer Vietnamese/i);
    expect(system).not.toMatch(/answer in Vietnamese —/i);
    expect(system).not.toMatch(/Respond in Vietnamese only/i);
  });

  it("user prompt restates English-only", () => {
    const q = "what datasets are in this notebook?";
    const prompt = buildCitationUserPrompt(q, [
      chunk({
        text: "10-20% of people with severe mental disorder receive no treatment.",
        citationId: 1,
      }),
    ]);
    expect(prompt).toContain("Respond in English only");
    expect(prompt).not.toMatch(/Respond in Vietnamese only/i);
    expect(prompt).toContain(`Question: ${q}`);
  });

  it("system prompt has no VN answer-language branch for any query", () => {
    const system = buildCitationSystemPrompt("summarize the documents");
    expect(system).toMatch(/English only/i);
    expect(system).not.toMatch(/The user question is in Vietnamese/i);
    expect(system).not.toMatch(/detectAnswerLanguageHint/i);
  });
});
