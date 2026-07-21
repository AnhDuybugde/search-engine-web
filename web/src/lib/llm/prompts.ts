import type { RankedChunk } from "@/lib/ir/types";

/** Hard caps so free-tier Groq TPM (often ~6k/min) is not blown by long pages. */
const MAX_CHARS_PER_CHUNK = 700;
const MAX_TOTAL_CONTEXT_CHARS = 3500;

/**
 * Product rule: the website and model answers are English-only.
 * (Query language detection for bilingual answers was removed.)
 */
export function buildCitationSystemPrompt(_query?: string): string {
  return [
    "You are a careful research assistant for a document search product.",
    "Answer ONLY using the provided context snippets from the user's uploaded sources.",
    "Cite sources inline as [1], [2], etc. matching citation IDs.",
    "If the context is insufficient or does not contain what the user asked, say so clearly instead of inventing facts or listing unrelated content.",
    "Always respond in English only. Do not answer in Vietnamese or any other language.",
    "Do not translate the answer into another language unless the user explicitly asks for a translation (still keep the answer primarily in English if unclear).",
    "When quoting source text, keep technical terms and proper names as in the source when possible.",
    "Be concise (short paragraphs or bullets), structured, and accurate.",
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
    "Context (retrieved from the user's uploaded documents in this notebook only — not a global database catalog):",
    blocks.length
      ? blocks.join("\n\n---\n\n")
      : "(No context snippets were retrieved.)",
    "",
    "Respond in English only.",
    "Write an answer with inline citations like [1] or [2] when using context. Keep it under 250 words.",
    "If the Question asks for dataset/notebook names in a global database and the Context does not list them, say the context only covers this notebook's uploaded files and name those source titles if present.",
  ].join("\n");
}

export function estimatePromptChars(query: string, chunks: RankedChunk[]): number {
  return (
    buildCitationUserPrompt(query, chunks).length +
    buildCitationSystemPrompt(query).length
  );
}
