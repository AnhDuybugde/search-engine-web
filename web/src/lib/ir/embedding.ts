import { getConfig } from "@/lib/config";

export type EmbeddingProvider = "openai" | "huggingface" | "tei";

export type EmbeddingResult = {
  embeddings: number[][];
  provider: EmbeddingProvider;
  model: string;
};

type OpenAiEmbeddingResponse = {
  data?: Array<{ embedding?: number[] }>;
  error?: { message?: string } | string;
};

const DEFAULT_EMBEDDING_TIMEOUT_MS = 10_000;
const EMBEDDING_CIRCUIT_OPEN_MS = 30_000;

type EmbeddingCircuit = { openUntil: number };
const globalForEmbedding = globalThis as unknown as {
  __embeddingCircuits?: Map<string, EmbeddingCircuit>;
};
const embeddingCircuits =
  globalForEmbedding.__embeddingCircuits ?? new Map<string, EmbeddingCircuit>();
globalForEmbedding.__embeddingCircuits = embeddingCircuits;

function resolveEmbeddingTimeout(timeoutMs?: number) {
  if (timeoutMs != null && Number.isFinite(timeoutMs) && timeoutMs > 0) {
    return Math.floor(timeoutMs);
  }
  const configured = Number(process.env.EMBEDDING_TIMEOUT_MS);
  return Number.isFinite(configured) && configured > 0
    ? Math.floor(configured)
    : DEFAULT_EMBEDDING_TIMEOUT_MS;
}

function embeddingCircuitKey(endpoint: string, model: string) {
  return `${endpoint}::${model}`;
}

function baseUrlJoin(base: string, path: string) {
  return `${base.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
}

function normalizeVector(vec: number[]) {
  const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
  if (!Number.isFinite(norm) || norm === 0) return vec;
  return vec.map((v) => v / norm);
}

function parseHuggingFaceVectors(payload: unknown): number[][] {
  if (!Array.isArray(payload)) {
    throw new Error("Unexpected Hugging Face embedding response");
  }

  if (payload.length === 0) return [];

  if (typeof payload[0] === "number") {
    return [payload as number[]];
  }

  if (Array.isArray(payload[0]) && typeof payload[0][0] === "number") {
    return payload as number[][];
  }

  // Some feature-extraction responses are token embeddings: mean-pool them.
  if (
    Array.isArray(payload[0]) &&
    Array.isArray(payload[0][0]) &&
    typeof payload[0][0][0] === "number"
  ) {
    return (payload as number[][][]).map((tokens) => {
      const dims = tokens[0]?.length || 0;
      const pooled = Array.from({ length: dims }, () => 0);
      for (const token of tokens) {
        for (let i = 0; i < dims; i++) pooled[i] += token[i] || 0;
      }
      return pooled.map((v) => v / Math.max(tokens.length, 1));
    });
  }

  throw new Error("Unexpected Hugging Face embedding shape");
}

function validateEmbeddings(vectors: number[][], expected: number) {
  if (vectors.length !== expected) {
    throw new Error(`Embedding count mismatch: expected ${expected}, got ${vectors.length}`);
  }
  for (const vector of vectors) {
    if (!Array.isArray(vector) || vector.length === 0) {
      throw new Error("Embedding response contains an empty vector");
    }
    if (!vector.every((v) => typeof v === "number" && Number.isFinite(v))) {
      throw new Error("Embedding response contains non-numeric values");
    }
  }
}

export async function embedTexts(
  texts: string[],
  options?: { model?: string; signal?: AbortSignal; timeoutMs?: number },
): Promise<EmbeddingResult> {
  const cfg = getConfig();
  const model = options?.model?.trim() || cfg.EMBEDDING_MODEL;
  const input = texts.map((t) => t.trim()).filter(Boolean);
  if (input.length !== texts.length) {
    throw new Error("Cannot embed empty text");
  }
  if (!cfg.hasEmbedding) {
    throw new Error("Embedding provider not configured");
  }

  let endpoint = "";
  let body: unknown;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (cfg.EMBEDDING_API_KEY) {
    headers.Authorization = `Bearer ${cfg.EMBEDDING_API_KEY}`;
  }

  if (cfg.EMBEDDING_PROVIDER === "openai") {
    if (!cfg.EMBEDDING_API_URL) throw new Error("EMBEDDING_API_URL is required");
    endpoint = cfg.EMBEDDING_API_URL.endsWith("/embeddings")
      ? cfg.EMBEDDING_API_URL
      : baseUrlJoin(cfg.EMBEDDING_API_URL, "/embeddings");
    body = { model, input };
  } else if (cfg.EMBEDDING_PROVIDER === "huggingface") {
    endpoint =
      cfg.EMBEDDING_API_URL ||
      `https://router.huggingface.co/hf-inference/models/${encodeURIComponent(
        model,
      )}`;
    body = {
      inputs: input,
      normalize: true,
      truncate: true,
    };
  } else {
    if (!cfg.EMBEDDING_API_URL) throw new Error("EMBEDDING_API_URL is required");
    endpoint = cfg.EMBEDDING_API_URL;
    body = { inputs: input };
  }

  if (options?.signal?.aborted) {
    throw Object.assign(new Error("Aborted"), { name: "AbortError" });
  }

  const timeoutMs = resolveEmbeddingTimeout(options?.timeoutMs);
  const circuitKey = embeddingCircuitKey(endpoint, model);
  const circuit = embeddingCircuits.get(circuitKey);
  if (circuit && circuit.openUntil > Date.now()) {
    throw new Error(
      `Embedding provider temporarily unavailable; retrying in ${
        circuit.openUntil - Date.now()
      }ms`,
    );
  }
  if (circuit) embeddingCircuits.delete(circuitKey);

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onAbort = () => controller.abort();
  options?.signal?.addEventListener("abort", onAbort, { once: true });

  let data: unknown;
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Embedding error ${res.status}: ${text.slice(0, 200)}`);
    }

    data = await res.json();
  } catch (err) {
    if (timedOut) {
      embeddingCircuits.set(circuitKey, {
        openUntil: Date.now() + EMBEDDING_CIRCUIT_OPEN_MS,
      });
      throw new Error(`Embedding request timed out after ${timeoutMs}ms`);
    }
    if (options?.signal?.aborted) {
      throw Object.assign(new Error("Aborted"), { name: "AbortError" });
    }
    if (err instanceof TypeError) {
      embeddingCircuits.set(circuitKey, {
        openUntil: Date.now() + EMBEDDING_CIRCUIT_OPEN_MS,
      });
    }
    throw err;
  } finally {
    clearTimeout(timer);
    options?.signal?.removeEventListener("abort", onAbort);
  }
  let vectors: number[][];

  if (cfg.EMBEDDING_PROVIDER === "openai") {
    const parsed = data as OpenAiEmbeddingResponse;
    if (parsed.error) {
      const message =
        typeof parsed.error === "string" ? parsed.error : parsed.error.message;
      throw new Error(message || "Embedding API returned an error");
    }
    vectors = (parsed.data || []).map((row) => row.embedding || []);
  } else if (cfg.EMBEDDING_PROVIDER === "huggingface") {
    vectors = parseHuggingFaceVectors(data);
  } else {
    vectors = Array.isArray(data)
      ? (data as number[][])
      : ((data as { embeddings?: number[][] }).embeddings || []);
  }

  validateEmbeddings(vectors, input.length);
  embeddingCircuits.delete(circuitKey);

  return {
    embeddings: vectors.map(normalizeVector),
    provider: cfg.EMBEDDING_PROVIDER as EmbeddingProvider,
    model,
  };
}

export function cosineSimilarity(a: number[], b: number[]) {
  const len = Math.min(a.length, b.length);
  if (len === 0) return 0;
  let dot = 0;
  let aNorm = 0;
  let bNorm = 0;
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    aNorm += a[i] * a[i];
    bNorm += b[i] * b[i];
  }
  if (aNorm === 0 || bNorm === 0) return 0;
  return dot / (Math.sqrt(aNorm) * Math.sqrt(bNorm));
}
