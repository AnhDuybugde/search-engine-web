/**
 * Pre-compute and persist embeddings for a notebook's raw sources.
 * Query path then only embeds the user query (dense retrieval hot path).
 *
 * Vectors are stored in Supabase/Postgres `chunks.embedding_json`
 * (not MongoDB — durable app DB is Postgres via Supabase).
 */
import { randomUUID } from "crypto";
import { getConfig, IR_DEFAULTS } from "@/lib/config";
import {
  listSourcesForIndex,
  replaceNotebookChunks,
  updateNotebookIndexMeta,
  type ChunkWriteRow,
} from "@/lib/db/notebooks-repo";
import { expandRawSourcesToUnits } from "@/lib/ir/raw-units";
import { embedTexts } from "@/lib/ir/embedding";

const EMBED_BATCH = 16;
/** Cap stored units per notebook (dense index size). */
const MAX_INDEX_UNITS = Math.max(IR_DEFAULTS.maxChunksPerNotebook, 800);

export type IndexProgressEvent =
  | {
      type: "index_started";
      unitCount: number;
      message: string;
    }
  | {
      type: "index_progress";
      done: number;
      total: number;
      message: string;
    }
  | {
      type: "index_completed";
      unitCount: number;
      embeddedCount: number;
      model: string;
      provider: string;
      embedMs: number;
      totalMs: number;
      storage: "supabase-postgres";
      message: string;
    }
  | {
      type: "index_failed";
      message: string;
    }
  | {
      type: "index_skipped";
      message: string;
      reason: string;
    };

export type IndexNotebookResult = {
  notebookId: string;
  unitCount: number;
  embeddedCount: number;
  model: string;
  provider: string;
  embedMs: number;
  totalMs: number;
  status: "ready" | "skipped" | "failed";
  message: string;
};

/**
 * Expand raw sources → embed units → write `chunks` with embedding_json.
 * Idempotent: replaces all prior chunk rows for the notebook.
 */
export async function indexNotebookEmbeddings(
  notebookId: string,
  opts?: {
    maxUnits?: number;
    batchSize?: number;
    onProgress?: (event: IndexProgressEvent) => void;
  },
): Promise<IndexNotebookResult> {
  const cfg = getConfig();
  const emit = opts?.onProgress;
  const totalStart = performance.now();

  if (!cfg.hasEmbedding) {
    const message =
      "Embedding not configured (set EMBEDDING_API_KEY / EMBEDDING_API_URL). Raw text was stored; dense index skipped.";
    await updateNotebookIndexMeta(notebookId, {
      indexStatus: "skipped",
      indexMessage: message,
      unitCount: 0,
      embeddedCount: 0,
      indexedAt: null,
    });
    emit?.({ type: "index_skipped", message, reason: "no_embedding_config" });
    return {
      notebookId,
      unitCount: 0,
      embeddedCount: 0,
      model: cfg.EMBEDDING_MODEL,
      provider: cfg.EMBEDDING_PROVIDER,
      embedMs: 0,
      totalMs: Math.round(performance.now() - totalStart),
      status: "skipped",
      message,
    };
  }

  try {
    await updateNotebookIndexMeta(notebookId, {
      indexStatus: "indexing",
      indexMessage: "Building dense index…",
    });

    const sources = await listSourcesForIndex(notebookId);
    const units = expandRawSourcesToUnits(
      sources.map((s) => ({
        id: s.id,
        title: s.title,
        text: s.text,
        mime: s.mime,
      })),
    ).slice(0, opts?.maxUnits ?? MAX_INDEX_UNITS);

    emit?.({
      type: "index_started",
      unitCount: units.length,
      message: `Indexing ${units.length} units → Supabase Postgres`,
    });

    if (units.length === 0) {
      await replaceNotebookChunks(notebookId, []);
      const message = "No text units to embed.";
      await updateNotebookIndexMeta(notebookId, {
        indexStatus: "ready",
        indexMessage: message,
        unitCount: 0,
        embeddedCount: 0,
        indexedAt: new Date().toISOString(),
      });
      emit?.({
        type: "index_completed",
        unitCount: 0,
        embeddedCount: 0,
        model: cfg.EMBEDDING_MODEL,
        provider: cfg.EMBEDDING_PROVIDER,
        embedMs: 0,
        totalMs: Math.round(performance.now() - totalStart),
        storage: "supabase-postgres",
        message,
      });
      return {
        notebookId,
        unitCount: 0,
        embeddedCount: 0,
        model: cfg.EMBEDDING_MODEL,
        provider: cfg.EMBEDDING_PROVIDER,
        embedMs: 0,
        totalMs: Math.round(performance.now() - totalStart),
        status: "ready",
        message,
      };
    }

    const batchSize = opts?.batchSize ?? EMBED_BATCH;
    const embeddings: number[][] = [];
    let model = cfg.EMBEDDING_MODEL;
    let provider: string = cfg.EMBEDDING_PROVIDER;
    const embedStart = performance.now();

    for (let i = 0; i < units.length; i += batchSize) {
      const slice = units.slice(i, i + batchSize);
      let lastErr: unknown;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const res = await embedTexts(slice.map((u) => u.text));
          embeddings.push(...res.embeddings);
          model = res.model;
          provider = res.provider;
          lastErr = null;
          break;
        } catch (err) {
          lastErr = err;
          await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
        }
      }
      if (lastErr) throw lastErr;

      const done = Math.min(i + batchSize, units.length);
      emit?.({
        type: "index_progress",
        done,
        total: units.length,
        message: `Embedded ${done}/${units.length} units`,
      });
      process.stdout?.write?.(
        `[index] ${done}/${units.length} embedded\r`,
      );
    }

    const embedMs = Math.round(performance.now() - embedStart);
    const rows: ChunkWriteRow[] = units.map((u, i) => {
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

    emit?.({
      type: "index_progress",
      done: units.length,
      total: units.length,
      message: `Writing ${rows.length} vectors to database…`,
    });

    await replaceNotebookChunks(notebookId, rows);

    const embeddedCount = rows.filter(
      (r) => r.embedding && r.embedding.length > 0,
    ).length;
    const totalMs = Math.round(performance.now() - totalStart);
    const message = `Indexed ${embeddedCount}/${units.length} vectors in Postgres (${embedMs}ms embed)`;

    await updateNotebookIndexMeta(notebookId, {
      indexStatus: "ready",
      indexMessage: message,
      unitCount: units.length,
      embeddedCount,
      indexedAt: new Date().toISOString(),
    });

    emit?.({
      type: "index_completed",
      unitCount: units.length,
      embeddedCount,
      model,
      provider,
      embedMs,
      totalMs,
      storage: "supabase-postgres",
      message,
    });

    return {
      notebookId,
      unitCount: units.length,
      embeddedCount,
      model,
      provider,
      embedMs,
      totalMs,
      status: "ready",
      message,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Indexing failed";
    await updateNotebookIndexMeta(notebookId, {
      indexStatus: "failed",
      indexMessage: message,
    });
    emit?.({ type: "index_failed", message });
    return {
      notebookId,
      unitCount: 0,
      embeddedCount: 0,
      model: cfg.EMBEDDING_MODEL,
      provider: cfg.EMBEDDING_PROVIDER,
      embedMs: 0,
      totalMs: Math.round(performance.now() - totalStart),
      status: "failed",
      message,
    };
  }
}

/** Fire-and-forget wrapper for non-SSE paths (never throws to caller). */
export function scheduleNotebookIndex(notebookId: string): void {
  void indexNotebookEmbeddings(notebookId).then(
    (r) => {
      console.info(
        `[index] notebook ${notebookId}: ${r.status} ${r.embeddedCount}/${r.unitCount} — ${r.message}`,
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
