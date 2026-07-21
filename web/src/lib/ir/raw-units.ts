/**
 * Query-time expansion of raw sources into retrieval units.
 *
 * Storage stays raw (one source row, 0 chunks, 0 embeddings).
 * At ask time we split multi-record CSV / long prose so BM25/hybrid
 * can rank individual claims or paragraphs — not the whole file.
 */
import type { ChunkWithEmbedding } from "./types";

const MAX_UNITS_PER_SOURCE = 800;
const MIN_UNIT_CHARS = 24;
const MAX_UNIT_CHARS = 2_500;
/** Prose fallback: only split long blobs */
const PROSE_SPLIT_MIN_CHARS = 1_200;

export type RawSourceLike = {
  id: string;
  title: string;
  text: string;
  mime?: string | null;
};

/**
 * Split stored raw text into retrieval units (no DB writes, no embeddings).
 */
export function expandRawSourceToUnits(
  source: RawSourceLike,
): ChunkWithEmbedding[] {
  const text = (source.text || "").replace(/\u0000/g, "").trim();
  if (!text) return [];

  const recordUnits = splitCsvRecords(text, source);
  if (recordUnits.length >= 2) return recordUnits;

  if (text.length >= PROSE_SPLIT_MIN_CHARS) {
    const prose = splitProse(text, source);
    if (prose.length >= 2) return prose;
  }

  // Single unit — short note / single claim / non-structured file
  return [
    {
      chunkId: `raw-${source.id}`,
      documentId: source.id,
      title: source.title,
      text,
      chunkIndex: 0,
      embedding: null,
      embeddingModel: null,
    },
  ];
}

/**
 * CSV extractor format:
 *   Record 12
 *   claim: ...
 *   evidence_sentences: ...
 *
 * Also accepts loose "Record N" blocks separated by blank lines.
 */
function splitCsvRecords(
  text: string,
  source: RawSourceLike,
): ChunkWithEmbedding[] {
  // Require at least two "Record <n>" headers
  const headerRe = /^Record\s+(\d+)\s*$/gim;
  const headers = [...text.matchAll(headerRe)];
  if (headers.length < 2) return [];

  const units: ChunkWithEmbedding[] = [];
  for (let i = 0; i < headers.length && units.length < MAX_UNITS_PER_SOURCE; i++) {
    const m = headers[i];
    const start = m.index ?? 0;
    const end =
      i + 1 < headers.length ? (headers[i + 1].index ?? text.length) : text.length;
    const block = text.slice(start, end).trim();
    if (block.length < MIN_UNIT_CHARS) continue;

    const recNo = m[1] || String(i + 1);
    const body = block
      .replace(/^Record\s+\d+\s*/i, "")
      .trim()
      .slice(0, MAX_UNIT_CHARS);
    if (body.length < MIN_UNIT_CHARS) continue;

    // Prefer claim: line as title snippet when present
    const claimLine = body
      .split("\n")
      .map((l) => l.trim())
      .find((l) => /^claim\s*:/i.test(l));
    const claimText = claimLine
      ? claimLine.replace(/^claim\s*:\s*/i, "").trim()
      : body.slice(0, 120);
    const title = `${source.title} · #${recNo}${
      claimText ? ` — ${claimText.slice(0, 80)}` : ""
    }`;

    units.push({
      chunkId: `raw-${source.id}-r${recNo}`,
      // Distinct documentId so each claim ranks as its own result card
      documentId: `${source.id}#r${recNo}`,
      title,
      text: body,
      chunkIndex: units.length,
      embedding: null,
      embeddingModel: null,
    });
  }
  return units;
}

/** Paragraph / sentence split for long non-CSV raw sources. */
function splitProse(
  text: string,
  source: RawSourceLike,
): ChunkWithEmbedding[] {
  // Prefer double-newline paragraphs, else sentence-ish cuts
  let parts = text
    .split(/\n{2,}/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter((p) => p.length >= MIN_UNIT_CHARS);

  if (parts.length < 2) {
    parts = text
      .split(/(?<=[.!?])\s+(?=[A-ZÀ-Ỹ"'])/)
      .map((p) => p.trim())
      .filter((p) => p.length >= MIN_UNIT_CHARS);
  }

  // Merge tiny leftovers; cap unit size
  const merged: string[] = [];
  let buf = "";
  for (const p of parts) {
    if (!buf) {
      buf = p;
      continue;
    }
    if (buf.length + 1 + p.length <= MAX_UNIT_CHARS) {
      buf = `${buf} ${p}`;
    } else {
      merged.push(buf.slice(0, MAX_UNIT_CHARS));
      buf = p;
    }
  }
  if (buf) merged.push(buf.slice(0, MAX_UNIT_CHARS));

  if (merged.length < 2) return [];

  return merged.slice(0, MAX_UNITS_PER_SOURCE).map((unit, i) => ({
    chunkId: `raw-${source.id}-p${i}`,
    documentId: `${source.id}#p${i}`,
    title: `${source.title} · part ${i + 1}`,
    text: unit,
    chunkIndex: i,
    embedding: null,
    embeddingModel: null,
  }));
}

/** Expand a list of raw sources into query-time units. */
export function expandRawSourcesToUnits(
  sources: RawSourceLike[],
): ChunkWithEmbedding[] {
  return sources.flatMap((s) => expandRawSourceToUnits(s));
}
