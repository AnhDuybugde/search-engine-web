import { requireUserId } from "@/lib/auth";
import { getConfig } from "@/lib/config";
import { createUploadSseResponse } from "@/lib/sse";
import { processNotebookUpload } from "@/lib/uploads/process-upload";

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
    await processNotebookUpload(id, uploadId, emit);
  }, req);
}
