import { z } from "zod";
import { createSession, listSessions } from "@/lib/db/sessions-repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const items = await listSessions(50);
    return Response.json({ items });
  } catch (err) {
    return Response.json(
      {
        items: [],
        error: err instanceof Error ? err.message : "Failed to list sessions",
      },
      { status: 500 },
    );
  }
}

const createSchema = z.object({
  title: z.string().min(1).max(200).optional(),
});

export async function POST(req: Request) {
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
    return Response.json(
      { error: err instanceof Error ? err.message : "Create failed" },
      { status: 500 },
    );
  }
}
