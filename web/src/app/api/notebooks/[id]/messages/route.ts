import { requireUserId } from "@/lib/auth";
import { getNotebook } from "@/lib/db/notebooks-repo";
import { listNotebookMessages } from "@/lib/db/notebook-messages-repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = requireUserId(req);
  if ("error" in auth) return auth.error;

  const { id } = await ctx.params;
  const notebook = await getNotebook(id);
  if (!notebook) {
    return Response.json({ error: "Notebook not found" }, { status: 404 });
  }

  try {
    const messages = await listNotebookMessages(id, auth.userId);
    return Response.json({ messages });
  } catch (err) {
    return Response.json(
      {
        error: err instanceof Error ? err.message : "Failed to load messages",
        messages: [],
      },
      { status: 500 },
    );
  }
}
