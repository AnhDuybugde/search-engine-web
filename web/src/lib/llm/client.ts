import { createOpenAI } from "@ai-sdk/openai";
import { streamText } from "ai";
import { getConfig, IR_DEFAULTS, resolveLlmConfig } from "@/lib/config";
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

function createProviderForModel(modelName?: string) {
  const cfg = getConfig();
  const resolved = resolveLlmConfig(modelName, cfg);
  if (!resolved.apiKey) throw new Error(`API key is not configured for ${resolved.model}`);
  return {
    provider: createOpenAI({
      baseURL: resolved.baseUrl,
      apiKey: resolved.apiKey,
      name: resolved.model === cfg.VILAO_MODEL ? "vilao-compatible" : "groq-compatible",
    }),
    model: resolved.model,
  };
}

function shrinkChunks(chunks: RankedChunk[], keep: number): RankedChunk[] {
  return chunks.slice(0, keep).map((c, i) => ({
    ...c,
    citationId: i + 1,
    finalRank: i + 1,
  }));
}

/** Hide provider reasoning tags while preserving the final answer stream. */
function createThinkingFilter(onVisible: (text: string) => void) {
  let pending = "";
  let thinking = false;
  const open = "<think>";
  const close = "</think>";

  const emitOutsideTags = (text: string, flush = false) => {
    pending += text;
    while (pending) {
      if (thinking) {
        const end = pending.indexOf(close);
        if (end < 0) {
          if (flush) pending = "";
          return;
        }
        pending = pending.slice(end + close.length);
        thinking = false;
        continue;
      }

      const start = pending.indexOf(open);
      if (start >= 0) {
        if (start > 0) onVisible(pending.slice(0, start));
        pending = pending.slice(start + open.length);
        thinking = true;
        continue;
      }

      if (flush) {
        onVisible(pending);
        pending = "";
        return;
      }

      // Keep a possible partial tag at the token boundary.
      const maxTail = Math.min(pending.length, open.length - 1);
      let keep = 0;
      for (let size = maxTail; size > 0; size--) {
        const suffix = pending.slice(-size);
        if (open.startsWith(suffix)) {
          keep = size;
          break;
        }
      }
      if (pending.length > keep) onVisible(pending.slice(0, pending.length - keep));
      pending = keep ? pending.slice(-keep) : "";
      return;
    }
  };

  return {
    push(text: string) {
      emitOutsideTags(text);
    },
    flush() {
      emitOutsideTags("", true);
    },
  };
}

/**
 * Stream an answer from Groq (or any OpenAI-compatible chat endpoint).
 * Automatically shrinks context and retries once on TPM / payload-too-large errors.
 */
export async function streamAnswer(params: {
  query: string;
  chunks: RankedChunk[];
  model?: string;
  sourceScope?: "notebook" | "web-scholarly";
  onToken: (token: string) => void | Promise<void>;
  signal?: AbortSignal;
}): Promise<string> {
  const selected = createProviderForModel(params.model);
  const openai = selected.provider;
  // Force Chat Completions — not /v1/responses
  const model = openai.chat(selected.model);
  const isReasoningModel = /minimax|deepseek|qwq|reasoning|thinking/i.test(
    selected.model,
  );

  let workingChunks = shrinkChunks(params.chunks, Math.min(params.chunks.length, 4));
  let maxPerChunk = IR_DEFAULTS.llmMaxCharsPerChunk;
  let maxTotal = IR_DEFAULTS.llmMaxContextChars;
  // Reasoning models spend output tokens on hidden thinking before the final
  // answer. Give them a larger budget so the visible academic answer is not
  // starved after the reasoning block.
  let maxOutputTokens = isReasoningModel
    ? Math.max(IR_DEFAULTS.maxOutputTokens, 2200)
    : Math.max(IR_DEFAULTS.maxOutputTokens, 1200);
  for (let attempt = 0; attempt < 3; attempt++) {
    if (params.signal?.aborted) {
      const err = new Error("Aborted");
      err.name = "AbortError";
      throw err;
    }
    const system = buildCitationSystemPrompt(params.query, {
      sourceScope: params.sourceScope,
    });
    const prompt = buildCitationUserPrompt(params.query, workingChunks, {
      maxCharsPerChunk: maxPerChunk,
      maxTotalChars: maxTotal,
      sourceScope: params.sourceScope,
    });

    try {
      const result = streamText({
        model,
        system,
        prompt,
        temperature: IR_DEFAULTS.temperature,
        maxOutputTokens,
        abortSignal: params.signal,
      });

      let full = "";
      let raw = "";
      const visibleParts: string[] = [];
      const thinkingFilter = createThinkingFilter((visible) => {
        full += visible;
        visibleParts.push(visible);
      });
      for await (const part of result.textStream) {
        raw += part;
        if (params.signal?.aborted) {
          const err = new Error("Aborted");
          err.name = "AbortError";
          (err as Error & { partial?: string }).partial = full;
          throw err;
        }
        thinkingFilter.push(part);
        for (const visible of visibleParts.splice(0)) {
          await params.onToken(visible);
        }
      }
      thinkingFilter.flush();
      for (const visible of visibleParts.splice(0)) {
        await params.onToken(visible);
      }
      if (!full.trim()) {
        // A reasoning provider can consume its entire output budget inside
        // <think>...</think>. Retry with a larger budget before surfacing a
        // false "empty response" error to the user.
        if (/<think\b/i.test(raw) && attempt < 2) {
          maxOutputTokens = Math.min(maxOutputTokens * 2, 2800);
          continue;
        }
        throw new Error("LLM returned empty response");
      }
      return full;
    } catch (err) {
      if ((err as Error)?.name === "AbortError") {
        throw err;
      }
      const message = err instanceof Error ? err.message : String(err);
      const tooLarge =
        /too large|rate_limit|TPM|tokens per minute|413|reduce your message/i.test(
          message,
        );
      const emptyResponse = message === "LLM returned empty response";

      if ((!tooLarge && !emptyResponse) || attempt === 2) {
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
