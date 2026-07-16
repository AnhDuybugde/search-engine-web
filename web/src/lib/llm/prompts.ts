import type { RankedChunk } from "@/lib/ir/types";

/** Hard caps so free-tier Groq TPM (often ~6k/min) is not blown by long pages. */
const MAX_CHARS_PER_CHUNK = 700;
const MAX_TOTAL_CONTEXT_CHARS = 3500;

export function buildCitationSystemPrompt(): string {
  return [
    "You are a careful research assistant.",
    "Answer ONLY using the provided context snippets.",
    "Cite sources inline as [1], [2], etc. matching citation IDs.",
    "If the context is insufficient, say what is missing instead of inventing facts.",
    "Be concise (short paragraphs or bullets), structured, and accurate.",
    "Prefer Vietnamese if the user question is in Vietnamese; otherwise match the user language.",
  ].join(" ");
}

function truncate(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

export function buildCitationUserPrompt(
  query: string,
  chunks: RankedChunk[],
  opts?: { maxCharsPerChunk?: number; maxTotalChars?: number },
): string {
  const maxPer = opts?.maxCharsPerChunk ?? MAX_CHARS_PER_CHUNK;
  const maxTotal = opts?.maxTotalChars ?? MAX_TOTAL_CONTEXT_CHARS;

  const blocks: string[] = [];
  let used = 0;

  for (const c of chunks) {
    const budget = Math.min(maxPer, maxTotal - used);
    if (budget < 80) break;
    const body = truncate(c.text, budget);
    const src = c.url || c.title;
    const block = `[${c.citationId}] ${truncate(c.title, 80)}\nSource: ${src}\n${body}`;
    blocks.push(block);
    used += body.length;
  }

  return [
    `Question: ${truncate(query, 500)}`,
    "",
    "Context:",
    blocks.join("\n\n---\n\n"),
    "",
    "Write an answer with inline citations like [1] or [2]. Keep it under 250 words.",
  ].join("\n");
}

export function estimatePromptChars(query: string, chunks: RankedChunk[]): number {
  return buildCitationUserPrompt(query, chunks).length + buildCitationSystemPrompt().length;
}
