import { z } from "zod";
import { requireUserId } from "@/lib/auth";
import {
  deleteNotebook,
  getNotebook,
  listSources,
  updateNotebook,
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

const patchSchema = z.object({
  title: z.string().min(1).max(200),
});

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = requireUserId(req);
  if ("error" in auth) return auth.error;

  const { id } = await ctx.params;
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) {
    return Response.json(
      { error: "Title is required (1–200 characters)." },
      { status: 400 },
    );
  }

  try {
    const notebook = await updateNotebook(id, {
      title: parsed.data.title.trim(),
    });
    if (!notebook) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }
    return Response.json(notebook);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Rename failed" },
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
