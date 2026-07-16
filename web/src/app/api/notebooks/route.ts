import { z } from "zod";
import { dbSetupHint } from "@/lib/config";
import { dbBackend } from "@/lib/db/client";
import { createNotebook, listNotebooks } from "@/lib/db/notebooks-repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createSchema = z.object({
  title: z.string().min(1).max(200),
});

export async function GET() {
  try {
    const items = await listNotebooks();
    return Response.json({ items, backend: dbBackend() });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to list notebooks";
    console.error("[GET /api/notebooks]", message);
    return Response.json(
      {
        error: message,
        items: [],
        backend: dbBackend(),
        hint: dbSetupHint(),
      },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  try {
    const json = await req.json().catch(() => null);
    const parsed = createSchema.safeParse(json);
    if (!parsed.success) {
      return Response.json(
        { error: "Title is required (1–200 characters)." },
        { status: 400 },
      );
    }
    const notebook = await createNotebook(parsed.data.title.trim());
    return Response.json(notebook, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create notebook";
    console.error("[POST /api/notebooks]", message);
    return Response.json(
      { error: message, backend: dbBackend(), hint: dbSetupHint() },
      { status: 500 },
    );
  }
}
