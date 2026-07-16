import { createOpenAI } from "@ai-sdk/openai";
import { streamText } from "ai";
import { getConfig, IR_DEFAULTS } from "@/lib/config";
import {
  buildCitationSystemPrompt,
  buildCitationUserPrompt,
} from "./prompts";
import type { RankedChunk } from "@/lib/ir/types";

export function createLlmProvider() {
  const cfg = getConfig();
  if (!cfg.LLM_API_KEY) {
    throw new Error("LLM_API_KEY is not set");
  }
  // name: 'chat' path — Groq does not implement OpenAI Responses API
  return createOpenAI({
    baseURL: cfg.LLM_BASE_URL,
    apiKey: cfg.LLM_API_KEY,
    name: "groq-compatible",
  });
}

function shrinkChunks(chunks: RankedChunk[], keep: number): RankedChunk[] {
  return chunks.slice(0, keep).map((c, i) => ({
    ...c,
    citationId: i + 1,
    finalRank: i + 1,
  }));
}

/**
 * Stream an answer from Groq (or any OpenAI-compatible chat endpoint).
 * Automatically shrinks context and retries once on TPM / payload-too-large errors.
 */
export async function streamAnswer(params: {
  query: string;
  chunks: RankedChunk[];
  onToken: (token: string) => void | Promise<void>;
}): Promise<string> {
  const cfg = getConfig();
  const openai = createLlmProvider();
  // Force Chat Completions — not /v1/responses
  const model = openai.chat(cfg.LLM_MODEL);

  let workingChunks = shrinkChunks(params.chunks, Math.min(params.chunks.length, 4));
  let maxPerChunk = 700;
  let maxTotal = 3200;

  for (let attempt = 0; attempt < 3; attempt++) {
    const system = buildCitationSystemPrompt();
    const prompt = buildCitationUserPrompt(params.query, workingChunks, {
      maxCharsPerChunk: maxPerChunk,
      maxTotalChars: maxTotal,
    });

    try {
      const result = streamText({
        model,
        system,
        prompt,
        temperature: IR_DEFAULTS.temperature,
        maxOutputTokens: Math.min(IR_DEFAULTS.maxOutputTokens, 600),
      });

      let full = "";
      for await (const part of result.textStream) {
        full += part;
        await params.onToken(part);
      }
      if (!full.trim()) {
        throw new Error("LLM returned empty response");
      }
      return full;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const tooLarge =
        /too large|rate_limit|TPM|tokens per minute|413|reduce your message/i.test(
          message,
        );

      if (!tooLarge || attempt === 2) {
        throw err instanceof Error ? err : new Error(message);
      }

      // Shrink context and retry
      workingChunks = shrinkChunks(workingChunks, Math.max(2, workingChunks.length - 1));
      maxPerChunk = Math.max(280, Math.floor(maxPerChunk * 0.55));
      maxTotal = Math.max(1200, Math.floor(maxTotal * 0.55));
    }
  }

  throw new Error("LLM generation failed after retries");
}
