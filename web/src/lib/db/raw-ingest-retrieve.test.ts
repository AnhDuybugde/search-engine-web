/**
 * End-to-end unit path: raw addSource → loadChunks → BM25 / notebook-ask.
 * Forces in-memory backend so the shipped repo functions run without remote DB.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bm25Retrieve } from "@/lib/ir/bm25";
import { runNotebookAskPipeline } from "@/lib/pipeline/notebook-ask";
import {
  addSource,
  countChunks,
  createNotebook,
  loadChunks,
} from "./notebooks-repo";
import { memChunks, memNotebooks, memSources } from "./memory";

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
] as const;

describe("raw-sources-only ingest → load → retrieve (shipped path)", () => {
  const prev: Record<string, string | undefined> = {};
  const touchedNotebookIds: string[] = [];

  beforeEach(() => {
    for (const k of DB_KEYS) prev[k] = process.env[k];
    for (const k of DB_KEYS) delete process.env[k];
    process.env.ALLOW_MEMORY_DB = "1";
  });

  afterEach(() => {
    for (const id of touchedNotebookIds) {
      memNotebooks.delete(id);
      for (const [sid, s] of memSources) {
        if (s.notebookId === id) memSources.delete(sid);
      }
      for (const [cid, c] of memChunks) {
        if (c.notebookId === id) memChunks.delete(cid);
      }
    }
    touchedNotebookIds.length = 0;
    for (const k of DB_KEYS) setEnv(k, prev[k]);
  });

  it("addSource stores only sources (0 chunks, 0 embeddings) and loadChunks yields full text", async () => {
    const notebook = await createNotebook("Raw unit notebook");
    touchedNotebookIds.push(notebook.id);

    const body =
      "BM25 is a probabilistic bag-of-words ranking function used in lexical retrieval for scientific literature.";

    const progress: Array<{ stage: string; ms: number }> = [];
    const added = await addSource(
      {
        notebookId: notebook.id,
        title: "bm25-intro.txt",
        mime: "text/plain",
        text: body,
      },
      (e) => progress.push(e),
    );

    expect(added.mode).toBe("raw-sources-only");
    expect(added.chunkCount).toBe(0);
    expect(added.embeddedCount).toBe(0);
    expect(added.charCount).toBe(body.length);
    expect(added.timing.storeMs).toBeGreaterThanOrEqual(0);
    expect(progress.every((p) => p.stage === "store")).toBe(true);
    expect(progress.some((p) => p.stage === "chunk" || p.stage === "embed")).toBe(
      false,
    );

    const storedChunks = await countChunks(notebook.id);
    expect(storedChunks).toBe(0);

    // No mem chunk rows for this notebook
    const memChunkRows = Array.from(memChunks.values()).filter(
      (c) => c.notebookId === notebook.id,
    );
    expect(memChunkRows).toHaveLength(0);

    const units = await loadChunks(notebook.id);
    expect(units).toHaveLength(1);
    expect(units[0].documentId).toBe(added.id);
    expect(units[0].text).toBe(body);
    expect(units[0].title).toBe("bm25-intro.txt");
    expect(units[0].embedding).toBeNull();
    expect(units[0].embeddingModel).toBeNull();
    expect(units[0].chunkId).toMatch(/^raw-/);
  });

  it("BM25 retrieves the raw full-source unit for a matching query", async () => {
    const notebook = await createNotebook("Raw retrieve notebook");
    touchedNotebookIds.push(notebook.id);

    const uniquePhrase =
      "xenon-calibrated infrared spectrometers for exoplanet atmospheres";
    const a = await addSource({
      notebookId: notebook.id,
      title: "exoplanet-spec.txt",
      mime: "text/plain",
      text: `This paper studies ${uniquePhrase} and reports novel calibration methods.`,
    });
    await addSource({
      notebookId: notebook.id,
      title: "unrelated-plant-biology.txt",
      mime: "text/plain",
      text: "Chloroplast genomes encode many proteins involved in photosynthesis pathways.",
    });

    expect(await countChunks(notebook.id)).toBe(0);

    const units = await loadChunks(notebook.id);
    expect(units).toHaveLength(2);
    expect(units.every((u) => u.embedding == null)).toBe(true);
    expect(units.every((u) => u.chunkId.startsWith("raw-"))).toBe(true);

    const hits = bm25Retrieve("infrared spectrometers exoplanet", units, 5);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].documentId).toBe(a.id);
    expect(hits[0].title).toBe("exoplanet-spec.txt");
    expect(hits[0].bm25Score).toBeGreaterThan(0);
  });

  it("runNotebookAskPipeline ranks raw-loaded units without pre-chunked state", async () => {
    const notebook = await createNotebook("Raw ask notebook");
    touchedNotebookIds.push(notebook.id);

    await addSource({
      notebookId: notebook.id,
      title: "transformers-attention.txt",
      mime: "text/plain",
      text: "Transformers use self-attention for sequence modeling in NLP and information retrieval.",
    });
    const bm25Doc = await addSource({
      notebookId: notebook.id,
      title: "bm25-ranking.txt",
      mime: "text/plain",
      text: "BM25 is a probabilistic bag-of-words ranking function for lexical retrieval in search engines.",
    });

    expect(await countChunks(notebook.id)).toBe(0);
    const units = await loadChunks(notebook.id);
    expect(units).toHaveLength(2);
    // Prove we start from raw load, not a hand-built chunk list
    expect(units.every((u) => u.chunkId.startsWith("raw-"))).toBe(true);

    const result = await runNotebookAskPipeline(
      {
        query: "BM25 lexical ranking function",
        chunks: units,
        documentTopK: 10,
        retrieveTopK: 10,
        contextTopK: 2,
        generateAnswer: false,
      },
      () => {},
    );

    expect(result.documents.length).toBeGreaterThan(0);
    expect(result.documents[0].documentId).toBe(bm25Doc.id);
    expect(result.documents[0].title).toMatch(/bm25/i);
    expect(result.metrics.chunkCount).toBe(2);
  });
});
