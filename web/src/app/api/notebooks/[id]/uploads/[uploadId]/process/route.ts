import { requireUserId } from "@/lib/auth";
import { getConfig } from "@/lib/config";
import { createUploadSseResponse } from "@/lib/sse";
import { processNotebookUpload, processStatelessNotebookUpload } from "@/lib/uploads/process-upload";
import { statelessUploadSchema } from "@/lib/uploads/upload-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string; uploadId: string }> },
) {
  const auth = requireUserId(req);
  if ("error" in auth) return auth.error;
  if (!getConfig().directStorageUploads) {
    return Response.json({ error: "Direct storage uploads are disabled" }, { status: 404 });
  }
  const { id, uploadId } = await ctx.params;
  return createUploadSseResponse(async (emit) => {
    const body = await req.clone().json().catch(() => null);
    const parsed = statelessUploadSchema.safeParse(body);
    if (parsed.success && parsed.data.uploadId === uploadId) {
      await processStatelessNotebookUpload(id, parsed.data, emit);
      return;
    }
    await processNotebookUpload(id, uploadId, emit);
  }, req);
}
