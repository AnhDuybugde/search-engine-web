import { deleteSearchRun, listSearchRuns } from "@/lib/db/runs-repo";

export const runtime = "nodejs";

export async function GET() {
  const items = await listSearchRuns(40);
  return Response.json({ items });
}

export async function DELETE(req: Request) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) {
    return Response.json({ error: "id required" }, { status: 400 });
  }
  await deleteSearchRun(id);
  return Response.json({ ok: true });
}
