import type { SessionMemory } from "./types";
import { CONTEXT_DEFAULTS } from "./types";

function trunc(s: string, max: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

export function buildExpandSystemPrompt(): string {
  return [
    "You rewrite follow-up search queries into standalone web-search queries.",
    "Resolve pronouns and vague references using the session context.",
    "Return ONLY valid JSON (no markdown) with keys:",
    'expandedQuery (string), entitiesToAdd (array of {name, type?}), resolvedReferents (string[]).',
    "Keep expandedQuery concise and searchable (under 200 chars).",
    "Prefer the user's language (Vietnamese or English).",
    "Do not invent facts; only rewrite the query.",
  ].join(" ");
}

export function buildExpandUserPrompt(
  query: string,
  memory: SessionMemory,
): string {
  const entities = memory.entities
    .slice(0, 8)
    .map((e) => {
      const aliases = e.aliases?.length ? ` (aka ${e.aliases.join(", ")})` : "";
      return `- ${e.name}${aliases}${e.type ? ` [${e.type}]` : ""}`;
    })
    .join("\n");

  const turns = memory.recentTurns
    .slice(-CONTEXT_DEFAULTS.recentTurnLimit)
    .map(
      (t) =>
        `${t.role === "user" ? "User" : "Assistant"}: ${trunc(t.text, CONTEXT_DEFAULTS.turnTextMaxChars)}`,
    )
    .join("\n");

  return [
    memory.summary ? `Session summary: ${trunc(memory.summary, 400)}` : "",
    entities ? `Known entities:\n${entities}` : "Known entities: (none)",
    turns ? `Recent turns:\n${turns}` : "Recent turns: (none)",
    "",
    `Current user message: ${trunc(query, 500)}`,
    "",
    "Rewrite into a standalone search query and extract entities mentioned.",
  ]
    .filter(Boolean)
    .join("\n");
}
