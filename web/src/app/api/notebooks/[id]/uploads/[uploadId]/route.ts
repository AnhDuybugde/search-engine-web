import { requireUserId } from "@/lib/auth";
import { getConfig } from "@/lib/config";
import { findNotebookUpload } from "@/lib/db/notebook-uploads-repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string; uploadId: string }> },
) {
  const auth = requireUserId(req);
  if ("error" in auth) return auth.error;
  if (!getConfig().directStorageUploads) {
    return Response.json({ error: "Direct storage uploads are disabled" }, { status: 404 });
  }
  const { id, uploadId } = await ctx.params;
  try {
    const upload = await findNotebookUpload(id, uploadId);
    if (!upload) return Response.json({ error: "Upload not found" }, { status: 404 });
    return Response.json(upload, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Could not load upload" }, { status: 500 });
  }
}
