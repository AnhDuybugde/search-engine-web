import { desc, eq, inArray } from "drizzle-orm";
import { randomUUID } from "crypto";
import { chunkDocument } from "@/lib/ir/chunker";
import type { Chunk } from "@/lib/ir/types";
import { IR_DEFAULTS } from "@/lib/config";
import { dbBackend, getDb, hasDb } from "./client";
import { chunks, notebooks, sources } from "./schema";
import { getSupabaseAdmin, toIso } from "./supabase";
import {
  memChunks,
  memNotebooks,
  memSources,
  type MemChunk,
  type MemNotebook,
  type MemSource,
} from "./memory";

function sbError(err: { message?: string; code?: string; details?: string } | null) {
  if (!err) return "Unknown Supabase error";
  return [err.message, err.code, err.details].filter(Boolean).join(" | ");
}

export async function listNotebooks() {
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

  const db = getDb();
  const rows = await db.select().from(notebooks).orderBy(desc(notebooks.createdAt));
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    createdAt: toIso(r.createdAt),
    updatedAt: toIso(r.updatedAt),
  }));
}

export async function createNotebook(title: string) {
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
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Postgres insert failed: ${msg}. On Vercel set SUPABASE_URL + SUPABASE_SECRET_KEY (recommended) or use pooler DATABASE_URL :6543.`,
    );
  }

  return {
    id,
    title: clean,
    createdAt: now,
    updatedAt: now,
  };
}

export async function getNotebook(id: string) {
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

export async function addSource(params: {
  notebookId: string;
  title: string;
  mime: string | null;
  text: string;
}) {
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
  const docChunks = chunkDocument({
    documentId: sourceId,
    title: params.title,
    text: params.text,
  });

  const existingChunkCount = await countChunks(params.notebookId);
  if (docChunks.length + existingChunkCount > IR_DEFAULTS.maxChunksPerNotebook) {
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
      createdAt: now,
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

    if (docChunks.length) {
      const { error: cErr } = await sb.from("chunks").insert(
        docChunks.map((c) => ({
          id: c.chunkId,
          source_id: sourceId,
          notebook_id: params.notebookId,
          chunk_index: c.chunkIndex,
          text: c.text,
          token_est: Math.ceil(c.text.split(/\s+/).length * 1.3),
        })),
      );
      if (cErr) throw new Error(`Save chunks failed: ${sbError(cErr)}`);
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
    createdAt: new Date(now),
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

  const sb = getSupabaseAdmin();
  if (sb) {
    let q = sb
      .from("chunks")
      .select("id,source_id,chunk_index,text")
      .eq("notebook_id", notebookId);
    if (sourceIds?.length) q = q.in("source_id", sourceIds);
    const { data: chunkRows, error } = await q;
    if (error) throw new Error(`Load chunks failed: ${sbError(error)}`);

    const ids = [...new Set((chunkRows || []).map((c) => c.source_id as string))];
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

    return (chunkRows || []).map((c) => ({
      chunkId: c.id as string,
      documentId: c.source_id as string,
      title: sourceMap.get(c.source_id as string) || "Source",
      text: c.text as string,
      chunkIndex: c.chunk_index as number,
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
