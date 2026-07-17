import type { SessionEntity, SessionMemory } from "./types";

/** Strong English anaphors (person/plural) — always need prior context. */
const EN_PERSON_DEICTIC_RE =
  /\b(he|she|him|her|his|hers|they|them|their|theirs)\b/i;

/** Weaker deictics — only count on short follow-ups (avoid "why use it?" in long Qs). */
const EN_WEAK_DEICTIC_RE =
  /\b(it|its|this|that|these|those)\b/i;

const EN_PHRASE_DEICTIC_RE =
  /\bthe (?:guy|man|woman|player|team|company|product|person)\b/i;

/**
 * Vietnamese anaphors — do NOT use \b (JS word boundaries are ASCII-only).
 * Match as whole tokens via unicode letter edges.
 */
const VI_DEICTICS = [
  "ông ấy",
  "bà ấy",
  "cô ấy",
  "anh ấy",
  "chị ấy",
  "họ",
  "người này",
  "người đó",
  "cái này",
  "cái đó",
  "điều đó",
  "người ta",
];

/** Loose proper-noun / capitalized multi-word heuristic (Latin scripts). */
const PROPER_NOUN_RE =
  /\b([A-ZÀ-Ỵ][\p{L}'’.-]+(?:\s+[A-ZÀ-Ỵ][\p{L}'’.-]+){0,3})\b/gu;

function normalizeVi(s: string): string {
  return s.toLowerCase().normalize("NFC");
}

export function hasDeicticReference(query: string): boolean {
  if (EN_PERSON_DEICTIC_RE.test(query) || EN_PHRASE_DEICTIC_RE.test(query)) {
    return true;
  }
  const wordCount = query.trim().split(/\s+/).filter(Boolean).length;
  // "it/this/that" in long standalone questions usually refer to something already named
  if (wordCount <= 6 && EN_WEAK_DEICTIC_RE.test(query)) {
    return true;
  }
  const q = normalizeVi(query);
  // Allow optional spaces / punctuation around multi-word forms
  for (const phrase of VI_DEICTICS) {
    const escaped = phrase.replace(/\s+/g, "\\s+");
    const re = new RegExp(`(?<![\\p{L}])${escaped}(?![\\p{L}])`, "iu");
    if (re.test(q)) return true;
  }
  // Standalone "đó" / "ấy" as object of question is common in short follow-ups
  if (/(?<![\p{L}])(đó|ấy|này)(?![\p{L}])/iu.test(q) && q.split(/\s+/).length <= 8) {
    return true;
  }
  return false;
}

export function looksSelfContained(query: string, memory: SessionMemory): boolean {
  if (!memory.entities.length && !memory.recentTurns.length) return true;
  if (hasDeicticReference(query)) return false;

  // If query already names a known entity, treat as self-contained
  const q = normalizeVi(query);
  for (const e of memory.entities) {
    if (q.includes(normalizeVi(e.name))) return true;
    for (const a of e.aliases || []) {
      if (a && q.includes(normalizeVi(a))) return true;
    }
  }

  const tokens = query.trim().split(/\s+/).filter(Boolean);

  // Short questions with session memory are almost always follow-ups
  if (tokens.length <= 5 && memory.entities.length > 0) return false;

  // Proper noun already in the query ⇒ usually standalone research question
  if (extractProperNouns(query).length > 0) return true;

  // Long questions without pronouns are usually standalone
  if (tokens.length >= 7) return true;
  return false;
}

export function dominantEntity(memory: SessionMemory): SessionEntity | null {
  if (!memory.entities.length) return null;
  return [...memory.entities].sort(
    (a, b) => (b.salience ?? 0) - (a.salience ?? 0),
  )[0];
}

/**
 * Cheap rewrite: if query has deixis and we know a top entity, splice entity name in.
 */
export function heuristicExpand(
  query: string,
  memory: SessionMemory,
): { expanded: string; entity?: SessionEntity } | null {
  const entity = dominantEntity(memory);
  if (!entity?.name) return null;

  const needs =
    hasDeicticReference(query) ||
    (!looksSelfContained(query, memory) && memory.entities.length > 0);
  if (!needs) return null;

  const name = entity.name;
  let expanded = query;

  // Vietnamese multi-word first (order longest → shortest)
  const viSubs: Array<[RegExp, string]> = [
    [/ông\s+ấy/giu, name],
    [/bà\s+ấy/giu, name],
    [/cô\s+ấy/giu, name],
    [/anh\s+ấy/giu, name],
    [/chị\s+ấy/giu, name],
    [/người\s+này/giu, name],
    [/người\s+đó/giu, name],
    [/người\s+ta/giu, name],
    [/cái\s+này/giu, name],
    [/cái\s+đó/giu, name],
    [/điều\s+đó/giu, name],
  ];
  for (const [re, rep] of viSubs) {
    expanded = expanded.replace(re, rep);
  }

  expanded = expanded
    .replace(/\b(he|she|him|her|they|them|it)\b/gi, name)
    .replace(/\b(his|hers|their|its)\b/gi, `${name}'s`);

  // Short follow-ups with no replaceable token: prefix entity
  if (expanded === query || !expanded.toLowerCase().includes(name.toLowerCase())) {
    expanded = `${name}: ${query}`;
  }
  return { expanded: expanded.trim(), entity };
}

export function extractProperNouns(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  PROPER_NOUN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PROPER_NOUN_RE.exec(text)) !== null) {
    const name = m[1].trim();
    if (/^(The|A|An|This|That|These|Those|I|We|You|They)$/i.test(name)) continue;
    const key = name.toLowerCase();
    if (seen.has(key) || name.length < 2) continue;
    seen.add(key);
    out.push(name);
  }
  return out.slice(0, 6);
}

export function needsExpansion(query: string, memory: SessionMemory): boolean {
  if (!memory.entities.length && !memory.recentTurns.length) return false;
  if (hasDeicticReference(query)) return true;
  if (looksSelfContained(query, memory)) return false;
  // Short follow-ups often omit the subject: "how old?", "bao nhiêu tuổi?"
  const words = query.trim().split(/\s+/).filter(Boolean);
  return words.length <= 7 && memory.entities.length > 0;
}
