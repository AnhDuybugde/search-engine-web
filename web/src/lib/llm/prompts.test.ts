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

  it("asks for complete academic and quantitative answers", () => {
    const q = "Compare AP and mAP@0.5 for all models and explain the differences.";
    const system = buildCitationSystemPrompt(q);
    const user = buildCitationUserPrompt(q, [
      chunk({
        text: "Model A achieved AP 72.4% and mAP@0.5 68.5% on Dataset X.",
        citationId: 1,
      }),
      chunk({
        text: "Model B achieved AP 65.1% and mAP@0.5 61.2% on Dataset X.",
        citationId: 2,
      }),
    ]);

    expect(system).toMatch(/academic, analytical/i);
    expect(system).toMatch(/multiple parts of the question/i);
    expect(system).toMatch(/quantitative detail/i);
    expect(user).toMatch(/400-900 words/i);
    expect(user).toMatch(/Markdown table/i);
    expect(user).toMatch(/exact reported values/i);
    expect(system).toMatch(/Do not conflate metrics, datasets, experiments, or units/i);
    expect(user).toMatch(/Do not merge values from different datasets or experiments/i);
    expect(user).toMatch(/complete table rows/i);
    expect(user).not.toMatch(/under 250 words/i);
  });

  it("selects a quantitative answer contract for metric questions", () => {
    const prompt = buildCitationUserPrompt(
      "What are the AP and mAP@0.5 values?",
      [chunk({ text: "AP 72.4%; mAP@0.5 68.5%", citationId: 1 })],
    );

    expect(prompt).toMatch(/Answer mode: quantitative extraction/i);
    expect(prompt).toMatch(/exact reported values and units/i);
  });

  it("treats document-finding questions as source discovery", () => {
    const q = "tìm các tài liệu liên quan tới vitamin";
    const chunks = [
      chunk({
        title: "Vitamins E and C in the prevention of prostate cancer",
        text: "The study evaluates vitamins E and C.",
        citationId: 1,
      }),
      chunk({
        title: "Vitamins E and C in the prevention of prostate cancer",
        text: "A randomized controlled study.",
        citationId: 2,
      }),
    ];
    const system = buildCitationSystemPrompt(q);
    const user = buildCitationUserPrompt(q, chunks);

    expect(system).toMatch(/source-discovery questions/i);
    expect(user).toMatch(/Retrieved source titles/i);
    expect(user).toMatch(/if one or more titles\/snippets directly match/i);
    expect(user).toContain("Vitamins E and C in the prevention of prostate cancer");
  });
});
