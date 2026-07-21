import type { Chunk, RankedChunk } from "./types";

/** Simple whitespace + unicode-friendly tokenizer */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-z0-9\u00c0-\u024f]+/i)
    .filter((t) => t.length > 1);
}

/**
 * Classic BM25 (Okapi) over in-memory chunks.
 * Pure TypeScript — safe for Vercel serverless cold starts.
 */
export function bm25Retrieve(
  query: string,
  chunks: Chunk[],
  topK = 20,
  k1 = 1.5,
  b = 0.75,
): RankedChunk[] {
  if (chunks.length === 0) return [];

  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) {
    return chunks.slice(0, topK).map((c, i) => ({
      ...c,
      bm25Score: 0,
      bm25Rank: i + 1,
      finalRank: i + 1,
      citationId: i + 1,
    }));
  }

  // Include source titles: scientific chunks often put the entity/model name
  // in the title while the body starts mid-section after PDF extraction.
  const docs = chunks.map((c) => tokenize(`${c.title} ${c.text}`));
  const N = docs.length;
  const avgdl = docs.reduce((s, d) => s + d.length, 0) / Math.max(N, 1);

  const df = new Map<string, number>();
  for (const doc of docs) {
    const unique = new Set(doc);
    for (const t of unique) df.set(t, (df.get(t) || 0) + 1);
  }

  const idf = (term: string) => {
    const n = df.get(term) || 0;
    return Math.log(1 + (N - n + 0.5) / (n + 0.5));
  };

  const scored = chunks.map((chunk, i) => {
    const doc = docs[i];
    const tfMap = new Map<string, number>();
    for (const t of doc) tfMap.set(t, (tfMap.get(t) || 0) + 1);
    const dl = doc.length || 1;

    let score = 0;
    for (const term of queryTokens) {
      const tf = tfMap.get(term) || 0;
      if (!tf) continue;
      const denom = tf + k1 * (1 - b + b * (dl / avgdl));
      score += idf(term) * ((tf * (k1 + 1)) / denom);
    }
    return { chunk, score };
  });

  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, topK).map((item, i) => ({
    chunkId: item.chunk.chunkId,
    documentId: item.chunk.documentId,
    title: item.chunk.title,
    url: item.chunk.url,
    text: item.chunk.text,
    chunkIndex: item.chunk.chunkIndex,
    bm25Score: item.score,
    bm25Rank: i + 1,
    finalRank: i + 1,
    citationId: i + 1,
  }));
}
