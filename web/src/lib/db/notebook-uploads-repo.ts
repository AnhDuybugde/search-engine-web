import { and, eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { assertDurableDb, getDb } from "./client";
import { getSupabaseAdmin, sbError, toIso } from "./supabase";
import { notebookUploads } from "./schema";
import type { NotebookUpload, UploadStage, UploadStatus } from "@/lib/uploads/upload-types";

function mapRow(row: Record<string, unknown>): NotebookUpload {
  return {
    id: String(row.id),
    notebookId: String(row.notebook_id ?? row.notebookId),
    storageBucket: String(row.storage_bucket ?? row.storageBucket),
    storagePath: String(row.storage_path ?? row.storagePath),
    originalFilename: String(row.original_filename ?? row.originalFilename),
    safeFilename: String(row.safe_filename ?? row.safeFilename),
    mime: row.mime == null ? null : String(row.mime),
    byteSize: Number(row.byte_size ?? row.byteSize),
    checksum: row.checksum == null ? null : String(row.checksum),
    status: String(row.status || "pending") as UploadStatus,
    stage: String(row.stage || "created") as UploadStage,
    progress: Number(row.progress || 0),
    sourceId: row.source_id == null ? null : String(row.source_id),
    errorMessage: row.error_message == null ? null : String(row.error_message),
    retryCount: Number(row.retry_count || 0),
    idempotencyKey:
      row.idempotency_key == null ? null : String(row.idempotency_key),
    createdAt: toIso(row.created_at ?? row.createdAt),
    updatedAt: toIso(row.updated_at ?? row.updatedAt),
    completedAt: row.completed_at ? toIso(row.completed_at) : null,
  };
}

const SELECT =
  "id,notebook_id,storage_bucket,storage_path,original_filename,safe_filename,mime,byte_size,checksum,status,stage,progress,source_id,error_message,retry_count,idempotency_key,created_at,updated_at,completed_at";

export async function createNotebookUpload(input: {
  notebookId: string;
  storageBucket: string;
  storagePath: string;
  originalFilename: string;
  safeFilename: string;
  mime: string | null;
  byteSize: number;
  checksum?: string;
  idempotencyKey?: string;
}): Promise<NotebookUpload> {
  assertDurableDb("Create upload");
  const id = randomUUID();
  const now = new Date().toISOString();
  const row = {
    id,
    notebook_id: input.notebookId,
    storage_bucket: input.storageBucket,
    storage_path: input.storagePath,
    original_filename: input.originalFilename,
    safe_filename: input.safeFilename,
    mime: input.mime,
    byte_size: input.byteSize,
    checksum: input.checksum || null,
    status: "pending",
    stage: "created",
    progress: 0,
    idempotency_key: input.idempotencyKey || null,
    created_at: now,
    updated_at: now,
  };
  const sb = getSupabaseAdmin();
  if (sb) {
    const { data, error } = await sb.from("notebook_uploads").insert(row).select(SELECT).single();
    if (error) throw new Error(`Create upload failed: ${sbError(error)}`);
    return mapRow(data as Record<string, unknown>);
  }
  const [created] = await getDb().insert(notebookUploads).values({
    id,
    notebookId: input.notebookId,
    storageBucket: input.storageBucket,
    storagePath: input.storagePath,
    originalFilename: input.originalFilename,
    safeFilename: input.safeFilename,
    mime: input.mime,
    byteSize: input.byteSize,
    checksum: input.checksum,
    idempotencyKey: input.idempotencyKey,
    createdAt: new Date(now),
    updatedAt: new Date(now),
  }).returning();
  return mapRow(created as unknown as Record<string, unknown>);
}

export async function findNotebookUpload(notebookId: string, id: string) {
  assertDurableDb("Load upload");
  const sb = getSupabaseAdmin();
  if (sb) {
    const { data, error } = await sb.from("notebook_uploads").select(SELECT).eq("id", id).eq("notebook_id", notebookId).maybeSingle();
    if (error) throw new Error(`Load upload failed: ${sbError(error)}`);
    return data ? mapRow(data as Record<string, unknown>) : null;
  }
  const [row] = await getDb().select().from(notebookUploads).where(and(eq(notebookUploads.id, id), eq(notebookUploads.notebookId, notebookId)));
  return row ? mapRow(row as unknown as Record<string, unknown>) : null;
}

export async function findNotebookUploadByIdempotency(
  notebookId: string,
  idempotencyKey: string,
) {
  assertDurableDb("Find upload");
  const sb = getSupabaseAdmin();
  if (sb) {
    const { data, error } = await sb
      .from("notebook_uploads")
      .select(SELECT)
      .eq("notebook_id", notebookId)
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    if (error) throw new Error(`Find upload failed: ${sbError(error)}`);
    return data ? mapRow(data as Record<string, unknown>) : null;
  }
  const [row] = await getDb()
    .select()
    .from(notebookUploads)
    .where(
      and(
        eq(notebookUploads.notebookId, notebookId),
        eq(notebookUploads.idempotencyKey, idempotencyKey),
      ),
    );
  return row ? mapRow(row as unknown as Record<string, unknown>) : null;
}

export async function updateNotebookUpload(
  notebookId: string,
  id: string,
  patch: Partial<Pick<NotebookUpload, "status" | "stage" | "progress" | "sourceId" | "errorMessage" | "retryCount" | "completedAt">>,
) {
  assertDurableDb("Update upload");
  const now = new Date().toISOString();
  const body: Record<string, unknown> = { updated_at: now };
  if (patch.status !== undefined) body.status = patch.status;
  if (patch.stage !== undefined) body.stage = patch.stage;
  if (patch.progress !== undefined) body.progress = Math.max(0, Math.min(100, patch.progress));
  if (patch.sourceId !== undefined) body.source_id = patch.sourceId;
  if (patch.errorMessage !== undefined) body.error_message = patch.errorMessage;
  if (patch.retryCount !== undefined) body.retry_count = patch.retryCount;
  if (patch.completedAt !== undefined) body.completed_at = patch.completedAt;
  const sb = getSupabaseAdmin();
  if (sb) {
    const { data, error } = await sb.from("notebook_uploads").update(body).eq("id", id).eq("notebook_id", notebookId).select(SELECT).single();
    if (error) throw new Error(`Update upload failed: ${sbError(error)}`);
    return mapRow(data as Record<string, unknown>);
  }
  const values = {
    updatedAt: new Date(now),
    ...(patch.status !== undefined ? { status: patch.status } : {}),
    ...(patch.stage !== undefined ? { stage: patch.stage } : {}),
    ...(patch.progress !== undefined ? { progress: Math.max(0, Math.min(100, patch.progress)) } : {}),
    ...(patch.sourceId !== undefined ? { sourceId: patch.sourceId } : {}),
    ...(patch.errorMessage !== undefined ? { errorMessage: patch.errorMessage } : {}),
    ...(patch.retryCount !== undefined ? { retryCount: patch.retryCount } : {}),
    ...(patch.completedAt !== undefined ? { completedAt: patch.completedAt ? new Date(patch.completedAt) : null } : {}),
  };
  const [row] = await getDb().update(notebookUploads).set(values).where(and(eq(notebookUploads.id, id), eq(notebookUploads.notebookId, notebookId))).returning();
  return row ? mapRow(row as unknown as Record<string, unknown>) : null;
}
