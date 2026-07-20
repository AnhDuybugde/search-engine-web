import { requireUserId } from "@/lib/auth";
import {
  deleteNotebook,
  getNotebook,
  listSources,
} from "@/lib/db/notebooks-repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = requireUserId(req);
  if ("error" in auth) return auth.error;

  const { id } = await ctx.params;
  try {
    // Parallel reads for realtime notebook open
    const [notebook, sources] = await Promise.all([
      getNotebook(id),
      listSources(id),
    ]);
    if (!notebook) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }
    return Response.json({ notebook, sources });
  } catch (err) {
    return Response.json(
      {
        error: err instanceof Error ? err.message : "Failed to load notebook",
        notebook: null,
        sources: [],
      },
      { status: 500 },
    );
  }
}

export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = requireUserId(req);
  if ("error" in auth) return auth.error;

  const { id } = await ctx.params;
  try {
    await deleteNotebook(id);
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Delete failed" },
      { status: 500 },
    );
  }
}
