import {
  deleteNotebook,
  getNotebook,
  listSources,
} from "@/lib/db/notebooks-repo";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const notebook = await getNotebook(id);
  if (!notebook) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  const sources = await listSources(id);
  return Response.json({ notebook, sources });
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  await deleteNotebook(id);
  return Response.json({ ok: true });
}
