import { getSearchRun } from "@/lib/db/runs-repo";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const run = await getSearchRun(id);
  if (!run) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  return Response.json(run);
}
