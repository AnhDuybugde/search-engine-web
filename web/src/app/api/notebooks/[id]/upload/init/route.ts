import { requireUserId } from "@/lib/auth";
import { getConfig } from "@/lib/config";
import { getNotebook } from "@/lib/db/notebooks-repo";
import {
  createNotebookUpload,
  findNotebookUploadByIdempotency,
} from "@/lib/db/notebook-uploads-repo";
import { createSignedStorageUpload, storageBucket } from "@/lib/storage/supabase-storage";
import {
  uploadMetadataSchema,
  validateUploadMetadata,
} from "@/lib/uploads/upload-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = requireUserId(req);
  if ("error" in auth) return auth.error;
  const cfg = getConfig();
  if (!cfg.directStorageUploads) {
    return Response.json({ error: "Direct storage uploads are disabled" }, { status: 404 });
  }
  if (!cfg.hasSupabaseRest) {
    return Response.json({ error: "Supabase Storage is not configured" }, { status: 503 });
  }
  const { id: notebookId } = await ctx.params;
  if (!(await getNotebook(notebookId))) {
    return Response.json({ error: "Notebook not found" }, { status: 404 });
  }
  const parsed = uploadMetadataSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "filename and a positive file size are required" }, { status: 400 });
  }
  try {
    const { safeFilename } = validateUploadMetadata(parsed.data);
    if (parsed.data.idempotencyKey) {
      const existing = await findNotebookUploadByIdempotency(
        notebookId,
        parsed.data.idempotencyKey,
      );
      if (existing) {
        if (existing.status === "completed") {
          return Response.json({
            error: "This upload has already been processed",
            uploadId: existing.id,
          }, { status: 409 });
        }
        const signed = await createSignedStorageUpload(existing.storagePath, true);
        return Response.json({
          uploadId: existing.id,
          bucket: existing.storageBucket,
          path: existing.storagePath,
          token: signed.token,
          signedUrl: signed.signedUrl,
          expiresIn: Number(cfg.UPLOAD_SIGNED_URL_TTL_SECONDS) || 900,
          resumed: true,
        }, { status: 200 });
      }
    }
    const uploadId = crypto.randomUUID();
    const path = `notebooks/${notebookId}/uploads/${uploadId}/${safeFilename}`;
    const upload = await createNotebookUpload({
      notebookId,
      storageBucket: storageBucket(),
      storagePath: path,
      originalFilename: parsed.data.filename,
      safeFilename,
      mime: parsed.data.mime || null,
      byteSize: parsed.data.size,
      checksum: parsed.data.checksum,
      idempotencyKey: parsed.data.idempotencyKey,
    });
    const signed = await createSignedStorageUpload(path);
    return Response.json({
      uploadId: upload.id,
      bucket: upload.storageBucket,
      path: upload.storagePath,
      token: signed.token,
      signedUrl: signed.signedUrl,
      expiresIn: Number(cfg.UPLOAD_SIGNED_URL_TTL_SECONDS) || 900,
    }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    // The tracking table is optional for the actual file path. If an older
    // deployment has not run migration 0006 yet, keep uploads working with a
    // scoped, stateless Storage path and process metadata from the client.
    if (/PGRST205|notebook_uploads|relation .* does not exist|schema cache/i.test(message)) {
      const { safeFilename } = validateUploadMetadata(parsed.data);
      const uploadId = crypto.randomUUID();
      const path = `notebooks/${notebookId}/uploads/${uploadId}/${safeFilename}`;
      const signed = await createSignedStorageUpload(path);
      return Response.json({
        uploadId,
        bucket: storageBucket(),
        path,
        token: signed.token,
        signedUrl: signed.signedUrl,
        expiresIn: Number(cfg.UPLOAD_SIGNED_URL_TTL_SECONDS) || 900,
        stateless: true,
      }, { status: 201 });
    }
    return Response.json({ error: message || "Could not initialize upload" }, { status: 400 });
  }
}
