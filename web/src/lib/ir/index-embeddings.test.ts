/**
 * Pre-index embeddings: expand units → mock embed store → loadChunks has vectors.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addSource,
  createNotebook,
  loadChunks,
} from "@/lib/db/notebooks-repo";
import { memChunks, memNotebooks, memSources } from "@/lib/db/memory";
import { indexNotebookEmbeddings } from "./index-embeddings";
import { retrieveEvidence } from "./adaptive-rrf";

vi.mock("@/lib/ir/embedding", () => ({
  embedTexts: async (texts: string[]) => ({
    embeddings: texts.map((_, i) => {
      // Deterministic pseudo-vectors
      const v = new Array(8).fill(0).map((__, j) => ((i + 1) * (j + 1)) / 10);
      const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
      return v.map((x) => x / norm);
    }),
    provider: "mock",
    model: "mock-embed",
  }),
  cosineSimilarity: (a: number[], b: number[]) => {
    let dot = 0;
    for (let i = 0; i < Math.min(a.length, b.length); i++) dot += a[i] * b[i];
    return dot;
  },
}));

function setEnv(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

const DB_KEYS = [
  "SUPABASE_URL",
  "SUPABASE_SECRET_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_SERVICE_KEY",
  "SUPABASE_SECRET",
  "NEXT_PUBLIC_SUPABASE_URL",
  "DATABASE_URL",
  "ALLOW_MEMORY_DB",
  "VERCEL",
  "VERCEL_ENV",
  "EMBEDDING_PROVIDER",
  "EMBEDDING_API_KEY",
  "EMBEDDING_MODEL",
] as const;

describe("indexNotebookEmbeddings (pre-store vectors)", () => {
  const prev: Record<string, string | undefined> = {};
  const touched: string[] = [];

  beforeEach(() => {
    for (const k of DB_KEYS) prev[k] = process.env[k];
    for (const k of DB_KEYS) delete process.env[k];
    process.env.ALLOW_MEMORY_DB = "1";
    process.env.EMBEDDING_PROVIDER = "huggingface";
    process.env.EMBEDDING_API_KEY = "test-key";
    process.env.EMBEDDING_MODEL = "mock-embed";
  });

  afterEach(() => {
    for (const id of touched) {
      memNotebooks.delete(id);
      for (const [sid, s] of memSources) {
        if (s.notebookId === id) memSources.delete(sid);
      }
      for (const [cid, c] of memChunks) {
        if (c.notebookId === id) memChunks.delete(cid);
      }
    }
    touched.length = 0;
    for (const k of DB_KEYS) setEnv(k, prev[k]);
    vi.clearAllMocks();
  });

  it("stores embeddings so loadChunks returns vectors (query path skips corpus embed)", async () => {
    const nb = await createNotebook("Index test");
    touched.push(nb.id);
    await addSource({
      notebookId: nb.id,
      title: "a.txt",
      mime: "text/plain",
      text: "Vitamin D helps calcium absorption in the intestine.",
    });
    await addSource({
      notebookId: nb.id,
      title: "b.txt",
      mime: "text/plain",
      text: "Melanoma immunotherapy with PD-1 blockade is effective.",
    });

    const before = await loadChunks(nb.id);
    expect(before.every((u) => !u.embedding)).toBe(true);

    const indexed = await indexNotebookEmbeddings(nb.id);
    expect(indexed.unitCount).toBeGreaterThanOrEqual(2);
    expect(indexed.embeddedCount).toBe(indexed.unitCount);

    const after = await loadChunks(nb.id);
    expect(after.length).toBe(indexed.unitCount);
    expect(after.every((u) => u.embedding && u.embedding.length > 0)).toBe(true);

    const cold = after.map((u) => ({ ...u, embedding: null }));
    const hot = after;

    const coldRes = await retrieveEvidence(
      "vitamin calcium",
      cold,
      5,
      "adaptive_rrf",
    );
    const hotRes = await retrieveEvidence(
      "vitamin calcium",
      hot,
      5,
      "adaptive_rrf",
    );

    expect(coldRes.diagnostics.denseUsed).toBe(true);
    expect(hotRes.diagnostics.denseUsed).toBe(true);
    // Both should return hits; hot uses pre-stored vectors
    expect(hotRes.results.length).toBeGreaterThan(0);
    expect(coldRes.results.length).toBeGreaterThan(0);
  });
});
