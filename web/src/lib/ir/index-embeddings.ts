/**
 * Pre-compute and persist embeddings for a notebook's raw sources.
 * Query path then only embeds the user query (dense retrieval hot path).
 */
import { randomUUID } from "crypto";
import { getConfig, IR_DEFAULTS } from "@/lib/config";
import {
  listSourcesForIndex,
  replaceNotebookChunks,
  type ChunkWriteRow,
} from "@/lib/db/notebooks-repo";
import { expandRawSourcesToUnits } from "@/lib/ir/raw-units";
import { embedTexts } from "@/lib/ir/embedding";

const EMBED_BATCH = 16;
/** Cap stored units per notebook (dense index size). */
const MAX_INDEX_UNITS = Math.max(IR_DEFAULTS.maxChunksPerNotebook, 800);

export type IndexNotebookResult = {
  notebookId: string;
  unitCount: number;
  embeddedCount: number;
  model: string;
  provider: string;
  embedMs: number;
  totalMs: number;
};

/**
 * Expand raw sources → embed units → write `chunks` with embedding_json.
 * Idempotent: replaces all prior chunk rows for the notebook.
 */
export async function indexNotebookEmbeddings(
  notebookId: string,
  opts?: { maxUnits?: number; batchSize?: number },
): Promise<IndexNotebookResult> {
  const cfg = getConfig();
  if (!cfg.hasEmbedding) {
    throw new Error(
      "Embedding not configured (set EMBEDDING_API_KEY / EMBEDDING_API_URL)",
    );
  }

  const totalStart = performance.now();
  const sources = await listSourcesForIndex(notebookId);
  const units = expandRawSourcesToUnits(
    sources.map((s) => ({
      id: s.id,
      title: s.title,
      text: s.text,
      mime: s.mime,
    })),
  ).slice(0, opts?.maxUnits ?? MAX_INDEX_UNITS);

  if (units.length === 0) {
    await replaceNotebookChunks(notebookId, []);
    return {
      notebookId,
      unitCount: 0,
      embeddedCount: 0,
      model: cfg.EMBEDDING_MODEL,
      provider: cfg.EMBEDDING_PROVIDER,
      embedMs: 0,
      totalMs: Math.round(performance.now() - totalStart),
    };
  }

  const batchSize = opts?.batchSize ?? EMBED_BATCH;
  const embeddings: number[][] = [];
  let model = cfg.EMBEDDING_MODEL;
  let provider = cfg.EMBEDDING_PROVIDER;
  const embedStart = performance.now();

  for (let i = 0; i < units.length; i += batchSize) {
    const slice = units.slice(i, i + batchSize);
    // Retry once on transient HF errors
    let lastErr: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await embedTexts(slice.map((u) => u.text));
        embeddings.push(...res.embeddings);
        model = res.model;
        provider = res.provider as typeof provider;
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
        await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
      }
    }
    if (lastErr) throw lastErr;
    process.stdout?.write?.(
      `[index] ${Math.min(i + batchSize, units.length)}/${units.length} embedded\r`,
    );
  }

  const embedMs = Math.round(performance.now() - embedStart);
  const rows: ChunkWriteRow[] = units.map((u, i) => {
    // Recover base source id from unit documentId (sourceId or sourceId#rN)
    const baseSourceId = u.documentId.split("#")[0];
    return {
      id: randomUUID(),
      sourceId: baseSourceId,
      notebookId,
      chunkIndex: i,
      text: u.text,
      embedding: embeddings[i] ?? null,
      embeddingModel: model,
    };
  });

  await replaceNotebookChunks(notebookId, rows);

  return {
    notebookId,
    unitCount: units.length,
    embeddedCount: rows.filter((r) => r.embedding && r.embedding.length > 0)
      .length,
    model,
    provider,
    embedMs,
    totalMs: Math.round(performance.now() - totalStart),
  };
}

/** Fire-and-forget wrapper for upload path (never throws to caller). */
export function scheduleNotebookIndex(notebookId: string): void {
  void indexNotebookEmbeddings(notebookId).then(
    (r) => {
      console.info(
        `[index] notebook ${notebookId}: ${r.embeddedCount}/${r.unitCount} vectors in ${r.embedMs}ms embed / ${r.totalMs}ms total`,
      );
    },
    (err) => {
      console.warn(
        `[index] notebook ${notebookId} failed:`,
        err instanceof Error ? err.message : err,
      );
    },
  );
}
