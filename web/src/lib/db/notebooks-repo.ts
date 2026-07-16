import { desc, eq, inArray } from "drizzle-orm";
import { randomUUID } from "crypto";
import { chunkDocument } from "@/lib/ir/chunker";
import type { Chunk } from "@/lib/ir/types";
import { IR_DEFAULTS } from "@/lib/config";
import { getDb, hasDb } from "./client";
import { chunks, notebooks, sources } from "./schema";
import {
  memChunks,
  memNotebooks,
  memSources,
  type MemChunk,
  type MemNotebook,
  type MemSource,
} from "./memory";

export async function listNotebooks() {
  if (!hasDb()) {
    return Array.from(memNotebooks.values()).sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
  }
  const db = getDb();
  const rows = await db.select().from(notebooks).orderBy(desc(notebooks.createdAt));
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }));
}

export async function createNotebook(title: string) {
  const clean = title.trim();
  if (!clean) throw new Error("Title is required");

  const id = randomUUID();
  const now = new Date();
  if (!hasDb()) {
    const row: MemNotebook = {
      id,
      title: clean,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    memNotebooks.set(id, row);
    return row;
  }

  try {
    const db = getDb();
    await db.insert(notebooks).values({
      id,
      title: clean,
      createdAt: now,
      updatedAt: now,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Supabase insert failed: ${msg}`);
  }

  return {
    id,
    title: clean,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}

export async function getNotebook(id: string) {
  if (!hasDb()) {
    return memNotebooks.get(id) || null;
  }
  const db = getDb();
  const rows = await db.select().from(notebooks).where(eq(notebooks.id, id)).limit(1);
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id,
    title: r.title,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

export async function deleteNotebook(id: string) {
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
  const db = getDb();
  await db.delete(chunks).where(eq(chunks.notebookId, id));
  await db.delete(sources).where(eq(sources.notebookId, id));
  await db.delete(notebooks).where(eq(notebooks.id, id));
}

export async function listSources(notebookId: string) {
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
  const db = getDb();
  const rows = await db.select().from(sources).where(eq(sources.notebookId, notebookId));
  return rows.map((s) => ({
    id: s.id,
    notebookId: s.notebookId,
    title: s.title,
    mime: s.mime,
    charCount: s.text.length,
    createdAt: s.createdAt.toISOString(),
  }));
}

export async function addSource(params: {
  notebookId: string;
  title: string;
  mime: string | null;
  text: string;
}) {
  const notebook = await getNotebook(params.notebookId);
  if (!notebook) throw new Error("Notebook not found");

  // enforce size limits
  let totalChars = params.text.length;
  if (!hasDb()) {
    for (const s of memSources.values()) {
      if (s.notebookId === params.notebookId) totalChars += s.text.length;
    }
  } else {
    const db = getDb();
    const rows = await db
      .select({ text: sources.text })
      .from(sources)
      .where(eq(sources.notebookId, params.notebookId));
    totalChars = rows.reduce((acc, r) => acc + r.text.length, 0) + params.text.length;
  }

  if (totalChars > IR_DEFAULTS.maxNotebookChars) {
    throw new Error(
      `Notebook text limit exceeded (${IR_DEFAULTS.maxNotebookChars} chars).`,
    );
  }

  const sourceId = randomUUID();
  const now = new Date();
  const docChunks = chunkDocument({
    documentId: sourceId,
    title: params.title,
    text: params.text,
  });

  if (docChunks.length + (await countChunks(params.notebookId)) > IR_DEFAULTS.maxChunksPerNotebook) {
    throw new Error(
      `Notebook chunk limit exceeded (${IR_DEFAULTS.maxChunksPerNotebook}).`,
    );
  }

  if (!hasDb()) {
    const source: MemSource = {
      id: sourceId,
      notebookId: params.notebookId,
      title: params.title,
      mime: params.mime,
      text: params.text,
      createdAt: now.toISOString(),
    };
    memSources.set(sourceId, source);
    for (const c of docChunks) {
      const row: MemChunk = {
        id: c.chunkId,
        sourceId,
        notebookId: params.notebookId,
        chunkIndex: c.chunkIndex,
        text: c.text,
      };
      memChunks.set(c.chunkId, row);
    }
    return {
      id: sourceId,
      title: params.title,
      chunkCount: docChunks.length,
      charCount: params.text.length,
    };
  }

  const db = getDb();
  await db.insert(sources).values({
    id: sourceId,
    notebookId: params.notebookId,
    title: params.title,
    mime: params.mime,
    text: params.text,
    createdAt: now,
  });
  if (docChunks.length) {
    await db.insert(chunks).values(
      docChunks.map((c) => ({
        id: c.chunkId,
        sourceId,
        notebookId: params.notebookId,
        chunkIndex: c.chunkIndex,
        text: c.text,
        tokenEst: Math.ceil(c.text.split(/\s+/).length * 1.3),
      })),
    );
  }

  return {
    id: sourceId,
    title: params.title,
    chunkCount: docChunks.length,
    charCount: params.text.length,
  };
}

async function countChunks(notebookId: string) {
  if (!hasDb()) {
    return Array.from(memChunks.values()).filter((c) => c.notebookId === notebookId)
      .length;
  }
  const db = getDb();
  const rows = await db
    .select({ id: chunks.id })
    .from(chunks)
    .where(eq(chunks.notebookId, notebookId));
  return rows.length;
}

export async function loadChunks(
  notebookId: string,
  sourceIds?: string[],
): Promise<Chunk[]> {
  if (!hasDb()) {
    let rows = Array.from(memChunks.values()).filter((c) => c.notebookId === notebookId);
    if (sourceIds?.length) {
      const set = new Set(sourceIds);
      rows = rows.filter((c) => set.has(c.sourceId));
    }
    const sourceMap = new Map(
      Array.from(memSources.values()).map((s) => [s.id, s] as const),
    );
    return rows.map((c) => ({
      chunkId: c.id,
      documentId: c.sourceId,
      title: sourceMap.get(c.sourceId)?.title || "Source",
      text: c.text,
      chunkIndex: c.chunkIndex,
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

  const sourceIdsNeeded = [...new Set(rows.map((r) => r.sourceId))];
  const sourceRows =
    sourceIdsNeeded.length === 0
      ? []
      : await db.select().from(sources).where(inArray(sources.id, sourceIdsNeeded));
  const sourceMap = new Map(sourceRows.map((s) => [s.id, s] as const));

  return rows.map((c) => ({
    chunkId: c.id,
    documentId: c.sourceId,
    title: sourceMap.get(c.sourceId)?.title || "Source",
    text: c.text,
    chunkIndex: c.chunkIndex,
  }));
}
