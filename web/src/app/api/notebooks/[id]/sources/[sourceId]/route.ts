import { z } from "zod";
import { requireUserId } from "@/lib/auth";
import {
  deleteSource,
  countChunks,
  getNotebook,
  getSourceDetail,
  renameSource,
  updateNotebookIndexMeta,
} from "@/lib/db/notebooks-repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string; sourceId: string }> },
) {
  const auth = requireUserId(req);
  if ("error" in auth) return auth.error;

  const { id, sourceId } = await ctx.params;
  const notebook = await getNotebook(id);
  if (!notebook) {
    return Response.json({ error: "Notebook not found" }, { status: 404 });
  }

  try {
    const source = await getSourceDetail(id, sourceId);
    if (!source) {
      return Response.json({ error: "Source not found" }, { status: 404 });
    }
    return Response.json({ source });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to load source" },
      { status: 500 },
    );
  }
}

const renameSchema = z.object({
  title: z.string().trim().min(1).max(200),
});

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string; sourceId: string }> },
) {
  const auth = requireUserId(req);
  if ("error" in auth) return auth.error;
  const { id, sourceId } = await ctx.params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = renameSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Provide a source name between 1 and 200 characters." },
      { status: 400 },
    );
  }

  try {
    const source = await renameSource(id, sourceId, parsed.data.title);
    if (!source) return Response.json({ error: "Source not found" }, { status: 404 });
    return Response.json({ source });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Rename failed" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ id: string; sourceId: string }> },
) {
  const auth = requireUserId(req);
  if ("error" in auth) return auth.error;
  const { id, sourceId } = await ctx.params;

  try {
    const deleted = await deleteSource(id, sourceId);
    if (!deleted) return Response.json({ error: "Source not found" }, { status: 404 });
    const notebook = await getNotebook(id);
    const remainingUnits = await countChunks(id);
    if (notebook) {
      await updateNotebookIndexMeta(id, {
        indexStatus: remainingUnits > 0 ? notebook.indexStatus : "none",
        indexMessage:
          remainingUnits > 0
            ? "Source removed; remaining retrieval index is available."
            : "No indexed sources remain.",
        unitCount: remainingUnits,
        embeddedCount:
          remainingUnits > 0
            ? Math.min(notebook.embeddedCount, remainingUnits)
            : 0,
        indexedAt: remainingUnits > 0 ? notebook.indexedAt : null,
      });
    }
    return Response.json({ ok: true, sourceId });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Delete failed" },
      { status: 500 },
    );
  }
}
