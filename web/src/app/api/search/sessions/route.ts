import { z } from "zod";
import {
  DurableDbRequiredError,
  requireDurableDb,
} from "@/lib/db/client";
import { createSession, listSessions } from "@/lib/db/sessions-repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const denied = requireDurableDb("List sessions");
  if (denied) return denied;
  try {
    const items = await listSessions(50);
    return Response.json({ items });
  } catch (err) {
    const status = err instanceof DurableDbRequiredError ? 503 : 500;
    return Response.json(
      {
        items: [],
        error: err instanceof Error ? err.message : "Failed to list sessions",
      },
      { status },
    );
  }
}

const createSchema = z.object({
  title: z.string().min(1).max(200).optional(),
});

export async function POST(req: Request) {
  const denied = requireDurableDb("Create session");
  if (denied) return denied;

  let json: unknown = {};
  try {
    const text = await req.text();
    if (text.trim()) json = JSON.parse(text);
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = createSchema.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: "Invalid body" }, { status: 400 });
  }

  try {
    const session = await createSession(parsed.data.title);
    return Response.json(session, { status: 201 });
  } catch (err) {
    const status = err instanceof DurableDbRequiredError ? 503 : 500;
    return Response.json(
      { error: err instanceof Error ? err.message : "Create failed" },
      { status },
    );
  }
}
