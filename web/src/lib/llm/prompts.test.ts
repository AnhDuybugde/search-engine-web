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

describe("citation prompts preserve user language and technical terms", () => {
  it("system prompt follows the user's language", () => {
    const system = buildCitationSystemPrompt(
      "ALW có công thức là gì?",
    );
    expect(system).toMatch(/Vietnamese/i);
    expect(system).toMatch(/Preserve technical terms/i);
    expect(system).not.toMatch(/English only/i);
  });

  it("user prompt follows the detected response language", () => {
    const q = "ALW có công thức là gì?";
    const prompt = buildCitationUserPrompt(q, [
      chunk({
        text: "10-20% of people with severe mental disorder receive no treatment.",
        citationId: 1,
      }),
    ]);
    expect(prompt).toContain("Respond naturally in Vietnamese");
    expect(prompt).toContain("Keep model names");
    expect(prompt).toContain(`Question: ${q}`);
  });

  it("system prompt follows English when the query is English", () => {
    const system = buildCitationSystemPrompt("summarize the documents");
    expect(system).toMatch(/same language as the user's question/i);
    expect(system).not.toMatch(/Do not answer in Vietnamese/i);
  });

  it("system and user prompts enforce grounded answers without fabrication", () => {
    const system = buildCitationSystemPrompt("What is the result?");
    const user = buildCitationUserPrompt("What is the result?", []);

    expect(system).toMatch(/only authoritative knowledge/i);
    expect(system).toMatch(/Do not use general world knowledge/i);
    expect(system).toMatch(/Never fabricate facts/i);
    expect(system).toMatch(/I don't know based on the provided documents/i);
    expect(user).toMatch(/complete evidence set/i);
    expect(user).toMatch(/do not guess/i);
  });
});
