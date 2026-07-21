/**
 * SGAF B5 + P3: Specialist-Generalist Adaptive Fusion
 *
 * Frozen from SEG paper.
 * - B5: batch (single-query) mode-switch based on 5 query features
 * - P3: rank-window smoothing (only in generalist-fallback mode)
 */
import { getConfig, IR_DEFAULTS } from "@/lib/config";
import { bm25Retrieve, tokenize } from "./bm25";
import { embedTexts } from "./embedding";
import type {
  HybridRetrievalDiagnostics,
} from "./adaptive-rrf";
import type {
  ChunkWithEmbedding,
  RankedChunk,
} from "./types";

// ---- Frozen z-score stats (from SciFact trainfit, 809 queries) ----
const Z_MEAN = [9.27, 0.0, 0.0, 0.0, 0.0];
const Z_STD = [4.12, 1.0, 1.0, 1.0, 1.0];

// ---- SGAF types ----
export type SgafMode = "specialist_safe" | "generalist_fallback";

export type SgafDiagnostics = HybridRetrievalDiagnostics & {
  mode: "sgaf";
  b5Mode: SgafMode;
  b5ShiftScore: number;
  specialistModel?: string;
  p3Applied: boolean;
};

// ---- Helpers ----
function porterStem(w: string) {
  let s = w.toLowerCase();
  if (s.endsWith("ies") && s.length > 3) s = `${s.slice(0, -3)}y`;
  else if (s.endsWith("es") && s.length > 3) s = s.slice(0, -2);
  else if (s.endsWith("s") && !s.endsWith("ss") && s.length > 2) s = s.slice(0, -1);
  if (s.endsWith("ing") && s.length > 5) s = s.slice(0, -3);
  if (s.endsWith("ed") && s.length > 4) s = s.slice(0, -2);
  return s;
}

function jaccardOverlap(a: string[], b: string[]): number {
  const sa = new Set(a);
  const sb = new Set(b);
  let intersect = 0;
  for (const x of sa) if (sb.has(x)) intersect++;
  return intersect / Math.max(sa.size, sb.size, 1);
}

/**
 * Extract 5 features from retrieval outputs (per query).
 * These are z-scored against SciFact trainfit statistics.
 */
function extractFeatures(
  query: string,
  smallResults: RankedChunk[],
  generalistResults: RankedChunk[],
): number[] {
  const f0 = tokenize(query).length; // query_len
  const f1 = smallResults[0]?.bm25Score ?? 0; // small_top (using bm25 score as proxy)
  const f2 =
    smallResults.length > 1
      ? (smallResults[0]?.bm25Score ?? 0) - (smallResults[1]?.bm25Score ?? 0)
      : 0; // small_gap
  const top10 = smallResults.slice(0, 10).map((r) => r.bm25Score);
  const mean = top10.reduce((s, v) => s + v, 0) / Math.max(top10.length, 1);
  const f3 = Math.sqrt(
    top10.reduce((s, v) => s + (v - mean) ** 2, 0) / Math.max(top10.length, 1),
  ); // small_std10
  const f4 = jaccardOverlap(
    smallResults.slice(0, 10).map((r) => r.chunkId),
    generalistResults.slice(0, 10).map((r) => r.chunkId),
  ); // overlap10
  return [f0, f1, f2, f3, f4];
}

/** Compute batch shift score S (Eq. 1 from paper) */
function shiftScore(features: number[]): number {
  const eps = 1e-8;
  const z0 = (features[0] - Z_MEAN[0]) / (Z_STD[0] + eps);
  const z1 = (features[1] - Z_MEAN[1]) / (Z_STD[1] + eps);
  const z2 = (features[2] - Z_MEAN[2]) / (Z_STD[2] + eps);
  const z3 = (features[3] - Z_MEAN[3]) / (Z_STD[3] + eps);
  const z4 = (features[4] - Z_MEAN[4]) / (Z_STD[4] + eps);
  return (
    Math.abs(z0) +
    Math.max(0, -z1) +
    Math.max(0, -z2) +
    Math.max(0, -z3) +
    Math.max(0, -z4)
  );
}

/**
 * P3 rank-window smoothing.
 * Only applied in generalist-fallback mode.
 * Blends specialist prior into top-window of generalist ranking.
 */
function p3Smooth(
  generalistResults: RankedChunk[],
  specialistResults: RankedChunk[],
  window: number,
  alpha: number,
  k: number,
): RankedChunk[] {
  if (window <= 0 || generalistResults.length === 0) return generalistResults;

  const specRank = new Map<string, number>();
  specialistResults.forEach((r, i) => specRank.set(r.chunkId, i + 1));

  const top = generalistResults.slice(0, window);
  const tail = generalistResults.slice(window);

  const rescored = top.map((chunk, i) => {
    const rb = i + 1;
    const rs = specRank.get(chunk.chunkId);
    const score =
      rs != null
        ? (1 - alpha) / (k + rb) + alpha / (k + rs)
        : (1 - alpha) / (k + rb);
    return { ...chunk, finalScore: score, finalRank: 0 };
  });

  rescored.sort((a, b) => (b.finalScore ?? 0) - (a.finalScore ?? 0));

  const result = [...rescored, ...tail];
  result.forEach((r, i) => {
    r.finalRank = i + 1;
    r.citationId = i + 1;
  });
  return result;
}

// ---- Import embedding externally (avoids circular deps) ----
type EmbedFn = (texts: string[], model?: string) => Promise<number[][]>;

/**
 * SGAF B5+P3 retrieval.
 * @param query User query text
 * @param chunks Corpus chunks (with or without embeddings)
 * @param topK Number of results
 * @param embedFn Async function (texts, model?) => embeddings[][]
 * @param specialistModel Hugging Face model ID for specialist
 * @param generalistModel Hugging Face model ID for generalist
 */
export async function sgafRetrieve(
  query: string,
  chunks: ChunkWithEmbedding[],
  topK: number,
  embedFn: EmbedFn,
  specialistModel: string,
  generalistModel: string,
): Promise<{
  results: RankedChunk[];
  diagnostics: SgafDiagnostics;
}> {
  const cfg = getConfig();
  const threshold = IR_DEFAULTS.sgafShiftThreshold;
  const p3Window = IR_DEFAULTS.p3Window;
  const p3Alpha = IR_DEFAULTS.p3Alpha;
  const k = IR_DEFAULTS.rrfK;

  if (chunks.length === 0) {
    return {
      results: [],
      diagnostics: {
        mode: "sgaf",
        b5Mode: "specialist_safe",
        b5ShiftScore: 0,
        denseUsed: false,
        specialistModel,
        p3Applied: false,
      },
    };
  }

  // ---- Build IDF vocabulary for adaptive weighting ----
  const df = new Map<string, number>();
  for (const c of chunks) {
    const terms = new Set(
      tokenize(c.text)
        .map(porterStem)
        .filter((t) => t.length >= 3),
    );
    for (const t of terms) df.set(t, (df.get(t) || 0) + 1);
  }
  const N = chunks.length;
  const idf = new Map<string, number>();
  for (const [term, count] of df) idf.set(term, Math.log(N / count));
  const idfValues = Array.from(idf.values());
  const medianIdf =
    idfValues.length > 0
      ? [...idfValues].sort((a, b) => a - b)[Math.floor(idfValues.length / 2)]
      : 0;

  // ---- BM25 pre-filter ----
  const bm25TopK = Math.max(topK, 160);
  const bm25All = bm25Retrieve(query, chunks, bm25TopK);
  const bm25Ms = 0; // already measured in bm25Retrieve

  // ---- Embed query with both models ----
  const queryText = `Represent this sentence for searching relevant passages: ${query}`;

  const [specialistEmb, generalistEmb] = await Promise.all([
    embedFn([queryText], specialistModel).then((r) => r[0]),
    embedFn([queryText], generalistModel).then((r) => r[0]),
  ]);

  // ---- Build candidate pool (specialist + generalist) ----
  const candidateIds = new Set(
    bm25All.slice(0, 160).map((h) => h.chunkId),
  );
  const candidates = chunks.filter((c) => candidateIds.has(c.chunkId));

  // ---- Specialized: BM25 + specialist dense fusion ----
  const specialistResults = fuseDense(
    candidates,
    specialistEmb,
    bm25All.filter((h) => candidateIds.has(h.chunkId)),
    topK,
    query,
    N,
    idf,
    medianIdf,
    k,
  );

  // ---- Generalist: BM25 + generalist dense fusion ----
  const generalistResults = fuseDense(
    candidates,
    generalistEmb,
    bm25All.filter((h) => candidateIds.has(h.chunkId)),
    topK,
    query,
    N,
    idf,
    medianIdf,
    k,
  );

  // ---- Extract features & compute shift score ----
  const features = extractFeatures(query, specialistResults, generalistResults);
  const S = shiftScore(features);

  // ---- B5 mode decision ----
  let final: RankedChunk[];
  let b5Mode: SgafMode;
  let p3Applied = false;

  if (S < threshold) {
    b5Mode = "specialist_safe";
    final = specialistResults;
  } else {
    b5Mode = "generalist_fallback";
    final = p3Smooth(generalistResults, specialistResults, p3Window, p3Alpha, k);
    p3Applied = true;
  }

  final.forEach((r, i) => {
    r.finalRank = i + 1;
    r.citationId = i + 1;
    r.retrievalMode = "sgaf" as RankedChunk["retrievalMode"];
  });

  return {
    results: final.slice(0, topK),
    diagnostics: {
      mode: "sgaf",
      b5Mode,
      b5ShiftScore: S,
      denseUsed: true,
      bm25Ms,
      specialistModel,
      p3Applied,
    },
  };
}

/** Cosine similarity-based dense retrieval */
function denseRetrieve(
  chunks: ChunkWithEmbedding[],
  queryEmb: number[],
  topK: number,
): { chunk: ChunkWithEmbedding; score: number; rank: number }[] {
  return chunks
    .map((c) => ({
      chunk: c,
      score: dotProduct(queryEmb, c.embedding ?? []),
    }))
    .filter((r) => Number.isFinite(r.score))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map((r, i) => ({ ...r, rank: i + 1 }));
}

function dotProduct(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) sum += a[i] * b[i];
  return sum;
}

/** Fuse BM25 + dense results via adaptive RRF */
function fuseDense(
  candidates: ChunkWithEmbedding[],
  queryEmb: number[],
  bm25: RankedChunk[],
  topK: number,
  query: string,
  N: number,
  idf: Map<string, number>,
  medianIdf: number,
  k: number,
): RankedChunk[] {
  const dense = denseRetrieve(candidates, queryEmb, topK);

  // Adaptive BM25 weight
  const stems = tokenize(query)
    .map(porterStem)
    .filter((t) => t.length >= 3);
  const meanIdf =
    stems.length > 0
      ? stems.reduce((s, t) => s + (idf.get(t) ?? medianIdf), 0) / stems.length
      : medianIdf;
  const logit = 1.0 * (meanIdf - medianIdf);
  const sigmoid = 1 / (1 + Math.exp(-logit));
  const bm25Weight = 0.05 + sigmoid * (0.9 - 0.05);

  const scores = new Map<string, number>();
  for (const h of bm25)
    scores.set(h.chunkId, bm25Weight / (k + h.bm25Rank));
  for (const d of dense)
    scores.set(
      d.chunk.chunkId,
      (scores.get(d.chunk.chunkId) || 0) + 1 / (k + d.rank),
    );

  return bm25
    .map((h) => {
      const d = dense.find((x) => x.chunk.chunkId === h.chunkId);
      return {
        ...h,
        ...d?.chunk,
        bm25Score: h.bm25Score,
        bm25Rank: h.bm25Rank,
        denseScore: d?.score,
        denseRank: d?.rank,
        finalScore: scores.get(h.chunkId) ?? 0,
        finalRank: 0,
        citationId: 0,
        bm25Weight,
      } as RankedChunk;
    })
    .sort((a, b) => (b.finalScore ?? 0) - (a.finalScore ?? 0))
    .slice(0, topK);
}
