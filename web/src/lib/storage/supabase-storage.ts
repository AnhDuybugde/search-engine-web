import { getConfig } from "@/lib/config";
import { getSupabaseAdmin } from "@/lib/db/supabase";

export function storageBucket(): string {
  return getConfig().storageBucket;
}

export async function createSignedStorageUpload(path: string, upsert = false) {
  const sb = getSupabaseAdmin();
  if (!sb) {
    throw new Error("Supabase Storage requires SUPABASE_URL and SUPABASE_SECRET_KEY.");
  }
  const { data, error } = await sb.storage
    .from(storageBucket())
    .createSignedUploadUrl(path, { upsert });
  if (error || !data?.token || !data.signedUrl) {
    throw new Error(error?.message || "Could not create signed upload URL.");
  }
  return { path, token: data.token, signedUrl: data.signedUrl };
}

export async function downloadStorageObject(bucket: string, path: string) {
  const sb = getSupabaseAdmin();
  if (!sb) {
    throw new Error("Supabase Storage is not configured.");
  }
  const { data, error } = await sb.storage.from(bucket).download(path);
  if (error || !data) {
    throw new Error(error?.message || "Could not download uploaded object.");
  }
  return data;
}

export async function getStorageObjectMetadata(bucket: string, path: string) {
  const sb = getSupabaseAdmin();
  if (!sb) throw new Error("Supabase Storage is not configured.");
  const parts = path.split("/");
  const name = parts.pop();
  const folder = parts.join("/");
  if (!name) return null;
  const { data, error } = await sb.storage.from(bucket).list(folder, {
    limit: 100,
    search: name,
  });
  if (error) throw new Error(error.message);
  const object = (data || []).find((item) => item.name === name);
  if (!object) return null;
  const size = Number((object.metadata as { size?: string | number } | null)?.size);
  return { size: Number.isFinite(size) && size > 0 ? size : null };
}

export async function removeStorageObject(bucket: string, path: string) {
  const sb = getSupabaseAdmin();
  if (!sb) return;
  const { error } = await sb.storage.from(bucket).remove([path]);
  if (error) console.warn("[storage cleanup]", error.message);
}
