import { z } from "zod";
import { requireUserId } from "@/lib/auth";
import {
  deleteSession,
  getSession,
  listMessages,
  updateSession,
} from "@/lib/db/sessions-repo";

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
    const session = await getSession(id, auth.userId);
    if (!session) {
      return Response.json({ error: "Session not found" }, { status: 404 });
    }
    const messages = await listMessages(id);
    return Response.json({ session, messages });
  } catch (err) {
    return Response.json(
      {
        error: err instanceof Error ? err.message : "Failed to load session",
        session: null,
        messages: [],
      },
      { status: 500 },
    );
  }
}

const patchSchema = z.object({
  title: z.string().min(1).max(200).optional(),
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
    return Response.json({ error: "Invalid body" }, { status: 400 });
  }

  try {
    const existing = await getSession(id, auth.userId);
    if (!existing) {
      return Response.json({ error: "Session not found" }, { status: 404 });
    }
    const session = await updateSession(id, { title: parsed.data.title });
    return Response.json(session);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Update failed" },
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
    const existing = await getSession(id, auth.userId);
    if (!existing) {
      return Response.json({ error: "Session not found" }, { status: 404 });
    }
    await deleteSession(id);
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Delete failed" },
      { status: 500 },
    );
  }
}
