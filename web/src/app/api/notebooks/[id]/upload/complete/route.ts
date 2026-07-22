import { requireUserId } from "@/lib/auth";
import { getConfig } from "@/lib/config";
import { findNotebookUpload, updateNotebookUpload } from "@/lib/db/notebook-uploads-repo";
import { getStorageObjectMetadata } from "@/lib/storage/supabase-storage";
import { uploadCompleteSchema } from "@/lib/uploads/upload-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = requireUserId(req);
  if ("error" in auth) return auth.error;
  if (!getConfig().directStorageUploads) {
    return Response.json({ error: "Direct storage uploads are disabled" }, { status: 404 });
  }
  const { id: notebookId } = await ctx.params;
  const parsed = uploadCompleteSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "uploadId is required" }, { status: 400 });
  try {
    const upload = await findNotebookUpload(notebookId, parsed.data.uploadId);
    if (!upload) return Response.json({ error: "Upload not found" }, { status: 404 });
    if (!["pending", "uploading", "failed"].includes(upload.status)) {
      return Response.json({ error: `Upload cannot be completed from ${upload.status}` }, { status: 409 });
    }
    const metadata = await getStorageObjectMetadata(upload.storageBucket, upload.storagePath);
    if (!metadata) {
      return Response.json({ error: "Uploaded object was not found in Storage" }, { status: 400 });
    }
    if (metadata.size != null && metadata.size !== upload.byteSize) {
      return Response.json({ error: "Uploaded object size does not match the declared size" }, { status: 400 });
    }
    const updated = await updateNotebookUpload(notebookId, upload.id, {
      status: "uploaded",
      stage: "upload",
      progress: 100,
      errorMessage: null,
    });
    return Response.json({ uploadId: upload.id, status: updated?.status || "uploaded" }, { status: 202 });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Could not complete upload" }, { status: 500 });
  }
}
