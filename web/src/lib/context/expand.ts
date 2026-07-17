import { generateText } from "ai";
import { getConfig } from "@/lib/config";
import { createLlmProvider } from "@/lib/llm/client";
import { entitiesFromText, mergeEntities } from "./entities";
import {
  heuristicExpand,
  needsExpansion,
} from "./heuristics";
import { buildExpandSystemPrompt, buildExpandUserPrompt } from "./prompts";
import type { ExpandResult, SessionEntity, SessionMemory } from "./types";
import { CONTEXT_DEFAULTS } from "./types";

type LlmExpandJson = {
  expandedQuery?: string;
  entitiesToAdd?: Array<{ name?: string; type?: string }>;
  resolvedReferents?: string[];
};

function parseJsonLoose(text: string): LlmExpandJson | null {
  const raw = text.trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : raw;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1)) as LlmExpandJson;
  } catch {
    return null;
  }
}

async function llmExpand(
  query: string,
  memory: SessionMemory,
): Promise<ExpandResult | null> {
  const cfg = getConfig();
  if (!cfg.hasLlm) return null;

  try {
    const openai = createLlmProvider();
    const model = openai.chat(cfg.LLM_MODEL);

    const result = await Promise.race([
      generateText({
        model,
        system: buildExpandSystemPrompt(),
        prompt: buildExpandUserPrompt(query, memory),
        temperature: 0,
        maxOutputTokens: 120,
      }),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("expand timeout")),
          CONTEXT_DEFAULTS.expandTimeoutMs,
        ),
      ),
    ]);

    const parsed = parseJsonLoose(result.text);
    const expanded = (parsed?.expandedQuery || "").trim();
    if (!expanded || expanded.length > 400) return null;

    const entitiesDelta: SessionEntity[] = (parsed?.entitiesToAdd || [])
      .filter((e) => e?.name && String(e.name).trim().length > 1)
      .map((e) => ({
        name: String(e.name).trim(),
        type: e.type ? String(e.type) : undefined,
        salience: 1,
      }));

    return {
      originalQuery: query,
      expandedQuery: expanded,
      usedContext: expanded.toLowerCase() !== query.toLowerCase(),
      method: "llm",
      entitiesDelta,
      resolvedReferents: parsed?.resolvedReferents?.filter(Boolean),
    };
  } catch (err) {
    console.warn("[expandQuery llm]", err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Expand a follow-up query using session memory (entities + recent turns).
 * Hybrid: skip when self-contained; heuristic first; LLM when needed.
 */
export async function expandQuery(
  rawQuery: string,
  memory: SessionMemory,
): Promise<ExpandResult> {
  const originalQuery = rawQuery.trim();
  if (!originalQuery) {
    return {
      originalQuery,
      expandedQuery: originalQuery,
      usedContext: false,
      method: "raw",
      entitiesDelta: [],
    };
  }

  // Always harvest proper nouns from the user message
  const fromUser = entitiesFromText(originalQuery);

  if (!needsExpansion(originalQuery, memory)) {
    return {
      originalQuery,
      expandedQuery: originalQuery,
      usedContext: false,
      method: "raw",
      entitiesDelta: fromUser,
    };
  }

  const heuristic = heuristicExpand(originalQuery, memory);
  const llm = await llmExpand(originalQuery, memory);

  if (llm) {
    return {
      ...llm,
      entitiesDelta: mergeEntities(fromUser, llm.entitiesDelta),
    };
  }

  if (heuristic) {
    return {
      originalQuery,
      expandedQuery: heuristic.expanded,
      usedContext: true,
      method: "heuristic",
      entitiesDelta: mergeEntities(
        fromUser,
        heuristic.entity ? [heuristic.entity] : [],
      ),
      resolvedReferents: heuristic.entity ? [heuristic.entity.name] : [],
    };
  }

  // Soft fallback: prefix dominant entity for short follow-ups
  const top = memory.entities[0];
  if (top?.name && originalQuery.split(/\s+/).length <= 6) {
    return {
      originalQuery,
      expandedQuery: `${top.name} ${originalQuery}`.trim(),
      usedContext: true,
      method: "heuristic",
      entitiesDelta: fromUser,
      resolvedReferents: [top.name],
    };
  }

  return {
    originalQuery,
    expandedQuery: originalQuery,
    usedContext: false,
    method: "raw",
    entitiesDelta: fromUser,
  };
}

export function buildMemoryFromSession(params: {
  entities?: SessionEntity[] | null;
  summary?: string | null;
  turns: Array<{ role: string; content: string }>;
}): SessionMemory {
  const recentTurns = params.turns
    .filter((t) => t.role === "user" || t.role === "assistant")
    .slice(-CONTEXT_DEFAULTS.recentTurnLimit)
    .map((t) => ({
      role: t.role as "user" | "assistant",
      text: t.content.slice(0, CONTEXT_DEFAULTS.turnTextMaxChars * 2),
    }));

  return {
    entities: params.entities || [],
    summary: params.summary,
    recentTurns,
  };
}
