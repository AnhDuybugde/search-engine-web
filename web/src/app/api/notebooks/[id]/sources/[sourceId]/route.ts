import { getNotebook, getSourceDetail } from "@/lib/db/notebooks-repo";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string; sourceId: string }> },
) {
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
