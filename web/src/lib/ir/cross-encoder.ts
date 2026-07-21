import { getConfig, IR_DEFAULTS } from "@/lib/config";

export type CrossEncoderResult = {
  scores: Array<{ id: string; score: number }>;
  model: string;
  provider: "huggingface" | "tei" | "none";
  ms: number;
  used: boolean;
  skippedReason?: string;
};

/**
 * Score (query, document) pairs with a cross-encoder via HF Inference / TEI.
 * Returns scores aligned to input order of `docs` (missing scores = -Infinity).
 */
export async function crossEncoderScore(
  query: string,
  docs: Array<{ id: string; text: string }>,
): Promise<CrossEncoderResult> {
  const start = performance.now();
  const cfg = getConfig();
  const model =
    cfg.RERANK_MODEL ||
    process.env.RERANK_MODEL ||
    "cross-encoder/ms-marco-MiniLM-L-6-v2";
  const apiKey = cfg.RERANK_API_KEY || cfg.EMBEDDING_API_KEY;
  const apiUrl = cfg.RERANK_API_URL;

  if (docs.length === 0) {
    return {
      scores: [],
      model,
      provider: "none",
      ms: 0,
      used: false,
      skippedReason: "No candidates",
    };
  }

  // Prefer explicit rerank endpoint; else HF router when key present.
  if (!apiUrl && !apiKey) {
    return {
      scores: docs.map((d) => ({ id: d.id, score: Number.NEGATIVE_INFINITY })),
      model,
      provider: "none",
      ms: Math.round(performance.now() - start),
      used: false,
      skippedReason: "Rerank provider not configured (set RERANK_API_URL or EMBEDDING_API_KEY)",
    };
  }

  const q = query.trim();
  const pairs = docs.map((d) => [
    q,
    d.text.length > 1500 ? d.text.slice(0, 1500) : d.text,
  ]);

  try {
    const batchSize = IR_DEFAULTS.crossEncoderBatchSize;
    const allScores: number[] = [];

    for (let i = 0; i < pairs.length; i += batchSize) {
      const batch = pairs.slice(i, i + batchSize);
      const scores = await scoreBatch({
        pairs: batch,
        model,
        apiKey,
        apiUrl,
      });
      allScores.push(...scores);
    }

    if (allScores.length !== docs.length) {
      throw new Error(
        `Cross-encoder score count mismatch: expected ${docs.length}, got ${allScores.length}`,
      );
    }

    return {
      scores: docs.map((d, i) => ({ id: d.id, score: allScores[i] })),
      model,
      provider: apiUrl && !apiUrl.includes("huggingface") ? "tei" : "huggingface",
      ms: Math.round(performance.now() - start),
      used: true,
    };
  } catch (err) {
    return {
      scores: docs.map((d) => ({ id: d.id, score: Number.NEGATIVE_INFINITY })),
      model,
      provider: "none",
      ms: Math.round(performance.now() - start),
      used: false,
      skippedReason:
        err instanceof Error ? err.message.slice(0, 200) : "Cross-encoder failed",
    };
  }
}

async function scoreBatch(params: {
  pairs: string[][];
  model: string;
  apiKey?: string;
  apiUrl?: string;
}): Promise<number[]> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (params.apiKey) headers.Authorization = `Bearer ${params.apiKey}`;

  const endpoint =
    params.apiUrl ||
    `https://router.huggingface.co/hf-inference/models/${encodeURIComponent(
      params.model,
    )}`;

  // HF sentence-transformers cross-encoders accept list of [text, text_pair]
  const res = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({ inputs: params.pairs }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Rerank error ${res.status}: ${text.slice(0, 180)}`);
  }

  const data: unknown = await res.json();
  return parseCrossEncoderScores(data, params.pairs.length);
}

function parseCrossEncoderScores(data: unknown, expected: number): number[] {
  // Flat array of scores: [0.1, 0.9, ...]
  if (Array.isArray(data) && data.every((v) => typeof v === "number")) {
    return data as number[];
  }

  // [{score: n}, ...] or [[{label, score}]]
  if (Array.isArray(data)) {
    const scores = data.map((row) => {
      if (typeof row === "number") return row;
      if (row && typeof row === "object") {
        const r = row as Record<string, unknown>;
        if (typeof r.score === "number") return r.score;
        if (Array.isArray(row)) {
          // classification-style: pick max score
          let best = Number.NEGATIVE_INFINITY;
          for (const item of row) {
            if (
              item &&
              typeof item === "object" &&
              typeof (item as { score?: number }).score === "number"
            ) {
              best = Math.max(best, (item as { score: number }).score);
            }
          }
          return best;
        }
      }
      return Number.NEGATIVE_INFINITY;
    });
    if (scores.length === expected) return scores;
  }

  // { scores: [...] }
  if (data && typeof data === "object" && Array.isArray((data as { scores?: unknown }).scores)) {
    const scores = (data as { scores: unknown[] }).scores.map((v) =>
      typeof v === "number" ? v : Number.NEGATIVE_INFINITY,
    );
    if (scores.length === expected) return scores;
  }

  throw new Error("Unexpected cross-encoder response shape");
}
