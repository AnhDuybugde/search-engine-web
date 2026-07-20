import { requireUserId } from "@/lib/auth";
import { IR_DEFAULTS } from "@/lib/config";
import { addSource, getNotebook } from "@/lib/db/notebooks-repo";
import { extractPdfText } from "@/lib/extract/pdf";
import { extractPlainText } from "@/lib/extract/text";
import { createUploadSseResponse } from "@/lib/sse";
import { elapsed, nowMs } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(
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
  const bytes = file.size;

  // Prefer SSE progress when client accepts event-stream; keep JSON fallback
  const accept = req.headers.get("accept") || "";
  const wantSse =
    accept.includes("text/event-stream") ||
    req.headers.get("x-upload-stream") === "1";

  if (!wantSse) {
    try {
      const extractStart = nowMs();
      let text = "";
      if (lower.endsWith(".pdf") || mime === "application/pdf") {
        text = await extractPdfText(buffer);
      } else {
        text = extractPlainText(name, buffer, mime);
      }
      text = text.replace(/\u0000/g, "").trim();
      if (!text) {
        return Response.json({ error: "No extractable text" }, { status: 400 });
      }
      const extractMs = elapsed(extractStart);
      const source = await addSource({
        notebookId: id,
        title: name,
        mime,
        text,
      });
      return Response.json(
        {
          ...source,
          timing: {
            extractMs,
            storeMs: source.timing.storeMs,
            totalMs: extractMs + source.timing.storeMs,
          },
        },
        { status: 201 },
      );
    } catch (err) {
      return Response.json(
        { error: err instanceof Error ? err.message : "Upload failed" },
        { status: 400 },
      );
    }
  }

  return createUploadSseResponse(async (emit) => {
    const totalStart = nowMs();
    emit({ type: "upload_started", filename: name, bytes });

    const extractStart = nowMs();
    let text = "";
    try {
      if (lower.endsWith(".pdf") || mime === "application/pdf") {
        text = await extractPdfText(buffer);
      } else {
        text = extractPlainText(name, buffer, mime);
      }
    } catch (err) {
      emit({
        type: "error",
        message: err instanceof Error ? err.message : "Extract failed",
      });
      return;
    }

    text = text.replace(/\u0000/g, "").trim();
    if (!text) {
      emit({ type: "error", message: "No extractable text" });
      return;
    }

    const extractMs = elapsed(extractStart);
    emit({ type: "extract_completed", chars: text.length, ms: extractMs });

    try {
      let storeMs = 0;
      const source = await addSource(
        {
          notebookId: id,
          title: name,
          mime,
          text,
        },
        (progress) => {
          if (progress.stage === "store") {
            storeMs = progress.ms;
          }
        },
      );

      emit({
        type: "store_completed",
        sourceId: source.id,
        ms: source.timing?.storeMs ?? storeMs,
      });

      const timing = {
        extractMs,
        storeMs: source.timing?.storeMs ?? storeMs,
        totalMs: elapsed(totalStart),
      };

      emit({
        type: "upload_completed",
        source: {
          id: source.id,
          title: source.title,
          chunkCount: 0,
          charCount: source.charCount,
          mode: "raw-sources-only",
        },
        timing,
        metrics: {
          chunkCount: 0,
          charCount: source.charCount,
          embeddedCount: 0,
          mode: "raw-sources-only",
        },
      });
    } catch (err) {
      emit({
        type: "error",
        message: err instanceof Error ? err.message : "Save failed",
      });
    }
  });
}
