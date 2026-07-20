import { desc, eq, inArray } from "drizzle-orm";
import { randomUUID } from "crypto";
import type { ChunkWithEmbedding } from "@/lib/ir/types";
import { IR_DEFAULTS } from "@/lib/config";
import { assertDurableDb, dbBackend, enrichDbError, getDb, hasDb } from "./client";
import { chunks, notebooks, sources } from "./schema";
import { getSupabaseAdmin, sbError, toIso } from "./supabase";
import {
  memChunks,
  memNotebooks,
  memSources,
  type MemNotebook,
  type MemSource,
} from "./memory";

function vectorOrNull(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null;
  if (!value.every((v) => typeof v === "number" && Number.isFinite(v))) return null;
  return value;
}

function isMissingEmbeddingColumn(error: unknown) {
  const text =
    typeof error === "string"
      ? error
      : error && typeof error === "object"
        ? JSON.stringify(error)
        : "";
  // Postgres undefined_column, or PostgREST schema-cache miss (PGRST204).
  return (
    text.includes("embedding_json") ||
    text.includes("embedding_model")
  ) && (
    text.includes("42703") ||
    text.includes("PGRST204") ||
    text.includes("schema cache") ||
    text.includes("does not exist") ||
    text.includes("Could not find")
  );
}

type ChunkRow = {
  id: string;
  source_id: string;
  chunk_index: number;
  text: string;
  embedding_json?: unknown;
  embedding_model?: string | null;
};

export async function listNotebooks() {
  assertDurableDb('List notebooks');
  if (!hasDb()) {
    return Array.from(memNotebooks.values()).sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
  }

  const sb = getSupabaseAdmin();
  if (sb) {
    const { data, error } = await sb
      .from("notebooks")
      .select("id,title,created_at,updated_at")
      .order("created_at", { ascending: false });
    if (error) throw new Error(`List notebooks failed: ${sbError(error)}`);
    return (data || []).map((r) => ({
      id: r.id as string,
      title: r.title as string,
      createdAt: toIso(r.created_at),
      updatedAt: toIso(r.updated_at),
    }));
  }

  try {
    const db = getDb();
    const rows = await db.select().from(notebooks).orderBy(desc(notebooks.createdAt));
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      createdAt: toIso(r.createdAt),
      updatedAt: toIso(r.updatedAt),
    }));
  } catch (err) {
    throw enrichDbError(err, "List notebooks");
  }
}

export async function createNotebook(title: string) {
  assertDurableDb('Create notebook');
  const clean = title.trim();
  if (!clean) throw new Error("Title is required");

  const id = randomUUID();
  const now = new Date().toISOString();

  if (!hasDb()) {
    const row: MemNotebook = {
      id,
      title: clean,
      createdAt: now,
      updatedAt: now,
    };
    memNotebooks.set(id, row);
    return row;
  }

  const sb = getSupabaseAdmin();
  if (sb) {
    const { data, error } = await sb
      .from("notebooks")
      .insert({
        id,
        title: clean,
        created_at: now,
        updated_at: now,
      })
      .select("id,title,created_at,updated_at")
      .single();

    if (error) {
      throw new Error(
        `Supabase insert failed (${dbBackend()}): ${sbError(error)}. ` +
          `If table missing, run web/drizzle/0000_init.sql in Supabase SQL Editor.`,
      );
    }

    return {
      id: data.id as string,
      title: data.title as string,
      createdAt: toIso(data.created_at, now),
      updatedAt: toIso(data.updated_at, now),
    };
  }

  try {
    const db = getDb();
    await db.insert(notebooks).values({
      id,
      title: clean,
      createdAt: new Date(now),
      updatedAt: new Date(now),
    });
  } catch (err) {
    throw enrichDbError(err, "Create notebook");
  }

  return {
    id,
    title: clean,
    createdAt: now,
    updatedAt: now,
  };
}

export async function getNotebook(id: string) {
  assertDurableDb('Get notebook');
  if (!hasDb()) {
    return memNotebooks.get(id) || null;
  }

  const sb = getSupabaseAdmin();
  if (sb) {
    const { data, error } = await sb
      .from("notebooks")
      .select("id,title,created_at,updated_at")
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(`Get notebook failed: ${sbError(error)}`);
    if (!data) return null;
    return {
      id: data.id as string,
      title: data.title as string,
      createdAt: toIso(data.created_at),
      updatedAt: toIso(data.updated_at),
    };
  }

  const db = getDb();
  const rows = await db.select().from(notebooks).where(eq(notebooks.id, id)).limit(1);
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id,
    title: r.title,
    createdAt: toIso(r.createdAt),
    updatedAt: toIso(r.updatedAt),
  };
}

export async function deleteNotebook(id: string) {
  assertDurableDb('Delete notebook');
  if (!hasDb()) {
    memNotebooks.delete(id);
    for (const [sid, s] of memSources) {
      if (s.notebookId === id) memSources.delete(sid);
    }
    for (const [cid, c] of memChunks) {
      if (c.notebookId === id) memChunks.delete(cid);
    }
    return;
  }

  const sb = getSupabaseAdmin();
  if (sb) {
    await sb.from("chunks").delete().eq("notebook_id", id);
    await sb.from("sources").delete().eq("notebook_id", id);
    const { error } = await sb.from("notebooks").delete().eq("id", id);
    if (error) throw new Error(`Delete notebook failed: ${sbError(error)}`);
    return;
  }

  const db = getDb();
  await db.delete(chunks).where(eq(chunks.notebookId, id));
  await db.delete(sources).where(eq(sources.notebookId, id));
  await db.delete(notebooks).where(eq(notebooks.id, id));
}

export async function listSources(notebookId: string) {
  assertDurableDb('List sources');
  if (!hasDb()) {
    return Array.from(memSources.values())
      .filter((s) => s.notebookId === notebookId)
      .map((s) => ({
        id: s.id,
        notebookId: s.notebookId,
        title: s.title,
        mime: s.mime,
        charCount: s.text.length,
        createdAt: s.createdAt,
      }));
  }

  const sb = getSupabaseAdmin();
  if (sb) {
    const { data, error } = await sb
      .from("sources")
      .select("id,notebook_id,title,mime,text,created_at")
      .eq("notebook_id", notebookId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(`List sources failed: ${sbError(error)}`);
    return (data || []).map((s) => ({
      id: s.id as string,
      notebookId: s.notebook_id as string,
      title: s.title as string,
      mime: (s.mime as string | null) ?? null,
      charCount: String(s.text || "").length,
      createdAt: toIso(s.created_at),
    }));
  }

  const db = getDb();
  const rows = await db.select().from(sources).where(eq(sources.notebookId, notebookId));
  return rows.map((s) => ({
    id: s.id,
    notebookId: s.notebookId,
    title: s.title,
    mime: s.mime,
    charCount: s.text.length,
    createdAt: toIso(s.createdAt),
  }));
}

/** Full source text + chunks for document detail drawer */
export async function getSourceDetail(notebookId: string, sourceId: string) {
  assertDurableDb('Get source');
  if (!hasDb()) {
    const source = memSources.get(sourceId);
    if (!source || source.notebookId !== notebookId) return null;
    const sourceChunks = Array.from(memChunks.values())
      .filter((c) => c.sourceId === sourceId)
      .sort((a, b) => a.chunkIndex - b.chunkIndex)
      .map((c) => ({
        chunkId: c.id,
        chunkIndex: c.chunkIndex,
        text: c.text,
      }));
    return {
      id: source.id,
      notebookId: source.notebookId,
      title: source.title,
      mime: source.mime,
      text: source.text,
      charCount: source.text.length,
      createdAt: source.createdAt,
      chunks: sourceChunks,
    };
  }

  const sb = getSupabaseAdmin();
  if (sb) {
    const { data: source, error } = await sb
      .from("sources")
      .select("id,notebook_id,title,mime,text,created_at")
      .eq("id", sourceId)
      .eq("notebook_id", notebookId)
      .maybeSingle();
    if (error) throw new Error(`Load source failed: ${sbError(error)}`);
    if (!source) return null;

    const { data: chunkRows, error: cErr } = await sb
      .from("chunks")
      .select("id,chunk_index,text")
      .eq("source_id", sourceId)
      .eq("notebook_id", notebookId)
      .order("chunk_index", { ascending: true });
    if (cErr) throw new Error(`Load source chunks failed: ${sbError(cErr)}`);

    const text = String(source.text || "");
    return {
      id: source.id as string,
      notebookId: source.notebook_id as string,
      title: source.title as string,
      mime: (source.mime as string | null) ?? null,
      text,
      charCount: text.length,
      createdAt: toIso(source.created_at),
      chunks: (chunkRows || []).map((c) => ({
        chunkId: c.id as string,
        chunkIndex: c.chunk_index as number,
        text: c.text as string,
      })),
    };
  }

  const db = getDb();
  const [source] = await db
    .select()
    .from(sources)
    .where(eq(sources.id, sourceId));
  if (!source || source.notebookId !== notebookId) return null;

  const chunkRows = await db
    .select()
    .from(chunks)
    .where(eq(chunks.sourceId, sourceId));
  chunkRows.sort((a, b) => a.chunkIndex - b.chunkIndex);

  return {
    id: source.id,
    notebookId: source.notebookId,
    title: source.title,
    mime: source.mime,
    text: source.text,
    charCount: source.text.length,
    createdAt: toIso(source.createdAt),
    chunks: chunkRows.map((c) => ({
      chunkId: c.id,
      chunkIndex: c.chunkIndex,
      text: c.text,
    })),
  };
}

/**
 * Persist progress for raw-only ingest.
 * Chunk/embed are intentionally not part of storage.
 */
export type SourceProgressEvent = { stage: "store"; ms: number };

export type AddSourceResult = {
  id: string;
  title: string;
  /** Always 0 for new ingest — raw sources only, no chunk rows written. */
  chunkCount: 0;
  charCount: number;
  timing: { storeMs: number };
  embeddedCount: 0;
  mode: "raw-sources-only";
};

/**
 * Store full document text in `sources` only.
 * No chunking, no embedding, no IR preprocessing at ingest time.
 */
export async function addSource(
  params: {
    notebookId: string;
    title: string;
    mime: string | null;
    text: string;
  },
  onProgress?: (event: SourceProgressEvent) => void,
): Promise<AddSourceResult> {
  assertDurableDb("Add source");
  const notebook = await getNotebook(params.notebookId);
  if (!notebook) throw new Error("Notebook not found");

  const existing = await listSources(params.notebookId);
  let totalChars = params.text.length;
  for (const s of existing) totalChars += s.charCount;

  if (totalChars > IR_DEFAULTS.maxNotebookChars) {
    throw new Error(
      `Notebook text limit exceeded (${IR_DEFAULTS.maxNotebookChars} chars).`,
    );
  }

  const sourceId = randomUUID();
  const now = new Date().toISOString();
  const storeStart = Date.now();

  if (!hasDb()) {
    const source: MemSource = {
      id: sourceId,
      notebookId: params.notebookId,
      title: params.title,
      mime: params.mime,
      text: params.text,
      createdAt: now,
    };
    memSources.set(sourceId, source);
    // deliberately no memChunks writes
    const storeMs = Date.now() - storeStart;
    onProgress?.({ stage: "store", ms: storeMs });
    return {
      id: sourceId,
      title: params.title,
      chunkCount: 0,
      charCount: params.text.length,
      timing: { storeMs },
      embeddedCount: 0,
      mode: "raw-sources-only",
    };
  }

  const sb = getSupabaseAdmin();
  if (sb) {
    const { error: sErr } = await sb.from("sources").insert({
      id: sourceId,
      notebook_id: params.notebookId,
      title: params.title,
      mime: params.mime,
      text: params.text,
      created_at: now,
    });
    if (sErr) throw new Error(`Save source failed: ${sbError(sErr)}`);

    const storeMs = Date.now() - storeStart;
    onProgress?.({ stage: "store", ms: storeMs });
    return {
      id: sourceId,
      title: params.title,
      chunkCount: 0,
      charCount: params.text.length,
      timing: { storeMs },
      embeddedCount: 0,
      mode: "raw-sources-only",
    };
  }

  const db = getDb();
  await db.insert(sources).values({
    id: sourceId,
    notebookId: params.notebookId,
    title: params.title,
    mime: params.mime,
    text: params.text,
    createdAt: new Date(now),
  });

  const storeMs = Date.now() - storeStart;
  onProgress?.({ stage: "store", ms: storeMs });
  return {
    id: sourceId,
    title: params.title,
    chunkCount: 0,
    charCount: params.text.length,
    timing: { storeMs },
    embeddedCount: 0,
    mode: "raw-sources-only",
  };
}

/** Count stored chunk rows (legacy corpora only; raw ingest writes 0). */
export async function countChunks(notebookId: string) {
  if (!hasDb()) {
    return Array.from(memChunks.values()).filter((c) => c.notebookId === notebookId)
      .length;
  }

  const sb = getSupabaseAdmin();
  if (sb) {
    const { count, error } = await sb
      .from("chunks")
      .select("id", { count: "exact", head: true })
      .eq("notebook_id", notebookId);
    if (error) throw new Error(`Count chunks failed: ${sbError(error)}`);
    return count || 0;
  }

  const db = getDb();
  const rows = await db
    .select({ id: chunks.id })
    .from(chunks)
    .where(eq(chunks.notebookId, notebookId));
  return rows.length;
}

/**
 * Load retrieval units for a notebook.
 * Prefer stored chunks when present; if the notebook is raw-only (sources with
 * no chunks), expose each source as one unprocessed unit (no embedding).
 */
export async function loadChunks(
  notebookId: string,
  sourceIds?: string[],
): Promise<ChunkWithEmbedding[]> {
  assertDurableDb('Load chunks');
  if (!hasDb()) {
    let rows = Array.from(memChunks.values()).filter((c) => c.notebookId === notebookId);
    if (sourceIds?.length) {
      const set = new Set(sourceIds);
      rows = rows.filter((c) => set.has(c.sourceId));
    }
    const sourceMap = new Map(
      Array.from(memSources.values()).map((s) => [s.id, s] as const),
    );
    if (rows.length) {
      return rows.map((c) => ({
        chunkId: c.id,
        documentId: c.sourceId,
        title: sourceMap.get(c.sourceId)?.title || "Source",
        text: c.text,
        chunkIndex: c.chunkIndex,
        embedding: c.embedding,
        embeddingModel: c.embeddingModel,
      }));
    }
    // raw sources only
    let srcs = Array.from(memSources.values()).filter(
      (s) => s.notebookId === notebookId,
    );
    if (sourceIds?.length) {
      const set = new Set(sourceIds);
      srcs = srcs.filter((s) => set.has(s.id));
    }
    return srcs.map((s, i) => ({
      chunkId: `raw-${s.id}`,
      documentId: s.id,
      title: s.title,
      text: s.text,
      chunkIndex: i,
      embedding: null,
      embeddingModel: null,
    }));
  }

  const sb = getSupabaseAdmin();
  if (sb) {
    let q = sb
      .from("chunks")
      .select("id,source_id,chunk_index,text,embedding_json,embedding_model")
      .eq("notebook_id", notebookId);
    if (sourceIds?.length) q = q.in("source_id", sourceIds);
    const selected = await q;
    let chunkRows = selected.data as ChunkRow[] | null;
    let error = selected.error;
    let hasEmbeddingColumns = true;
    if (error && isMissingEmbeddingColumn(error)) {
      hasEmbeddingColumns = false;
      let legacyQuery = sb
        .from("chunks")
        .select("id,source_id,chunk_index,text")
        .eq("notebook_id", notebookId);
      if (sourceIds?.length) legacyQuery = legacyQuery.in("source_id", sourceIds);
      const legacy = await legacyQuery;
      chunkRows = legacy.data as ChunkRow[] | null;
      error = legacy.error;
    }
    if (error) throw new Error(`Load chunks failed: ${sbError(error)}`);

    if (chunkRows && chunkRows.length > 0) {
      const ids = [...new Set(chunkRows.map((c) => c.source_id as string))];
      let sourceMap = new Map<string, string>();
      if (ids.length) {
        const { data: sourceRows } = await sb
          .from("sources")
          .select("id,title")
          .in("id", ids);
        sourceMap = new Map(
          (sourceRows || []).map((s) => [s.id as string, s.title as string]),
        );
      }

      return chunkRows.map((c) => ({
        chunkId: c.id as string,
        documentId: c.source_id as string,
        title: sourceMap.get(c.source_id as string) || "Source",
        text: c.text as string,
        chunkIndex: c.chunk_index as number,
        embedding: hasEmbeddingColumns
          ? vectorOrNull(c.embedding_json)
          : null,
        embeddingModel: hasEmbeddingColumns
          ? (c.embedding_model ?? null)
          : null,
      }));
    }

    // RAW corpus: sources only — no chunk rows, no embeddings
    let srcQuery = sb
      .from("sources")
      .select("id,title,text")
      .eq("notebook_id", notebookId);
    if (sourceIds?.length) srcQuery = srcQuery.in("id", sourceIds);
    const { data: rawSources, error: sErr } = await srcQuery;
    if (sErr) throw new Error(`Load sources failed: ${sbError(sErr)}`);
    return (rawSources || []).map((s, i) => ({
      chunkId: `raw-${s.id as string}`,
      documentId: s.id as string,
      title: (s.title as string) || "Source",
      text: (s.text as string) || "",
      chunkIndex: i,
      embedding: null,
      embeddingModel: null,
    }));
  }

  const db = getDb();
  let rows;
  if (sourceIds?.length) {
    rows = await db
      .select()
      .from(chunks)
      .where(eq(chunks.notebookId, notebookId))
      .then((all) => all.filter((r) => sourceIds.includes(r.sourceId)));
  } else {
    rows = await db.select().from(chunks).where(eq(chunks.notebookId, notebookId));
  }

  if (rows.length > 0) {
    const sourceIdsNeeded = [...new Set(rows.map((r) => r.sourceId))];
    const sourceRows =
      sourceIdsNeeded.length === 0
        ? []
        : await db
            .select()
            .from(sources)
            .where(inArray(sources.id, sourceIdsNeeded));
    const sourceMap = new Map(sourceRows.map((s) => [s.id, s] as const));

    return rows.map((c) => ({
      chunkId: c.id,
      documentId: c.sourceId,
      title: sourceMap.get(c.sourceId)?.title || "Source",
      text: c.text,
      chunkIndex: c.chunkIndex,
      embedding: vectorOrNull(c.embeddingJson),
      embeddingModel: c.embeddingModel,
    }));
  }

  // RAW: full sources as retrieval units
  let sourceRows = await db
    .select()
    .from(sources)
    .where(eq(sources.notebookId, notebookId));
  if (sourceIds?.length) {
    const set = new Set(sourceIds);
    sourceRows = sourceRows.filter((s) => set.has(s.id));
  }
  return sourceRows.map((s, i) => ({
    chunkId: `raw-${s.id}`,
    documentId: s.id,
    title: s.title,
    text: s.text,
    chunkIndex: i,
    embedding: null,
    embeddingModel: null,
  }));
}
