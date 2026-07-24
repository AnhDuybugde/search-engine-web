import { requireUserId } from "@/lib/auth";
import { indexNotebookEmbeddings } from "@/lib/ir/index-embeddings";
import { createUploadSseResponse } from "@/lib/sse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = requireUserId(req);
  if ("error" in auth) return auth.error;

  const { id } = await ctx.params;

  return createUploadSseResponse(async (emit) => {
    const result = await indexNotebookEmbeddings(id, {
      onProgress: (ev) => {
        emit(ev);
      },
    });
    if (result.status === "failed") {
      throw new Error(result.message);
    }
  }, req);
}
