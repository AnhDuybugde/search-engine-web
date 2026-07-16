import { dbSetupHint } from "@/lib/config";
import { dbBackend } from "@/lib/db/client";
import { deleteSearchRun, listSearchRuns } from "@/lib/db/runs-repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const items = await listSearchRuns(40);
    return Response.json({
      items,
      backend: dbBackend(),
      // Help surface misconfig when list is empty on postgres that silently fails
      hint: items.length === 0 && dbBackend() !== "memory" ? dbSetupHint() : undefined,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load history";
    console.error("[GET /api/web-search/history]", message);
    return Response.json(
      { items: [], error: message, backend: dbBackend(), hint: dbSetupHint() },
      { status: 500 },
    );
  }
}

export async function DELETE(req: Request) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) {
    return Response.json({ error: "id required" }, { status: 400 });
  }
  try {
    await deleteSearchRun(id);
    return Response.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to delete";
    return Response.json({ error: message }, { status: 500 });
  }
}
