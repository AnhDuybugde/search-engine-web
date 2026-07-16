import { IR_DEFAULTS } from "@/lib/config";
import { addSource, getNotebook } from "@/lib/db/notebooks-repo";
import { extractPdfText } from "@/lib/extract/pdf";
import { extractPlainText } from "@/lib/extract/text";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const notebook = await getNotebook(id);
  if (!notebook) {
    return Response.json({ error: "Notebook not found" }, { status: 404 });
  }

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: "file is required" }, { status: 400 });
  }

  if (file.size > IR_DEFAULTS.maxUploadBytes) {
    return Response.json(
      { error: `File too large (max ${IR_DEFAULTS.maxUploadBytes} bytes)` },
      { status: 400 },
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const name = file.name || "upload";
  const mime = file.type || null;
  const lower = name.toLowerCase();

  let text = "";
  try {
    if (lower.endsWith(".pdf") || mime === "application/pdf") {
      text = await extractPdfText(buffer);
    } else {
      text = extractPlainText(name, buffer, mime);
    }
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Extract failed" },
      { status: 400 },
    );
  }

  text = text.replace(/\u0000/g, "").trim();
  if (!text) {
    return Response.json({ error: "No extractable text" }, { status: 400 });
  }

  try {
    const source = await addSource({
      notebookId: id,
      title: name,
      mime,
      text,
    });
    return Response.json(source, { status: 201 });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Save failed" },
      { status: 400 },
    );
  }
}
