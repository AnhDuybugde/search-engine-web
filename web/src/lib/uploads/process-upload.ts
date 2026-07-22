import { elapsed, nowMs } from "@/lib/utils";
import { extractPdfText } from "@/lib/extract/pdf";
import { extractPlainText } from "@/lib/extract/text";
import { addSource, getSourceDetail } from "@/lib/db/notebooks-repo";
import {
  findNotebookUpload,
  updateNotebookUpload,
} from "@/lib/db/notebook-uploads-repo";
import { downloadStorageObject } from "@/lib/storage/supabase-storage";
import { indexNotebookEmbeddings } from "@/lib/ir/index-embeddings";
import type { UploadStreamEvent } from "@/lib/ir/types";

export async function processNotebookUpload(
  notebookId: string,
  uploadId: string,
  emit: (event: UploadStreamEvent) => void,
) {
  const upload = await findNotebookUpload(notebookId, uploadId);
  if (!upload) throw new Error("Upload not found");
  if (upload.status === "completed") {
    throw new Error("Upload has already been processed");
  }
  if (upload.status !== "uploaded" && upload.status !== "failed") {
    throw new Error(`Upload is not ready for processing (${upload.status})`);
  }

  const totalStart = nowMs();
  emit({
    type: "upload_started",
    filename: upload.originalFilename,
    bytes: upload.byteSize,
  });

  try {
    await updateNotebookUpload(notebookId, uploadId, {
      status: "extracting",
      stage: "extract",
      progress: 10,
      errorMessage: null,
    });

    const blob = await downloadStorageObject(upload.storageBucket, upload.storagePath);
    const buffer = Buffer.from(await blob.arrayBuffer());
    if (buffer.byteLength !== upload.byteSize) {
      throw new Error(
        `Uploaded object size mismatch (expected ${upload.byteSize}, received ${buffer.byteLength}).`,
      );
    }

    const extractStart = nowMs();
    const lower = upload.originalFilename.toLowerCase();
    let text =
      lower.endsWith(".pdf") || upload.mime === "application/pdf"
        ? await extractPdfText(buffer)
        : extractPlainText(upload.originalFilename, buffer, upload.mime);
    text = text.replace(/\u0000/g, "").trim();
    if (!text) throw new Error("No extractable text");
    const extractMs = elapsed(extractStart);
    emit({ type: "extract_completed", chars: text.length, ms: extractMs });

    await updateNotebookUpload(notebookId, uploadId, {
      status: "stored",
      stage: "store",
      progress: 25,
    });
    const existingSource = upload.sourceId
      ? await getSourceDetail(notebookId, upload.sourceId)
      : null;
    const source = existingSource
      ? {
          id: existingSource.id,
          title: existingSource.title,
          charCount: existingSource.charCount,
          timing: { storeMs: 0 },
        }
      : await addSource({
          notebookId,
          title: upload.originalFilename,
          mime: upload.mime,
          text,
        });
    if (!source) throw new Error("Stored source could not be loaded for retry");
    emit({
      type: "store_completed",
      sourceId: source.id,
      ms: source.timing.storeMs,
    });
    await updateNotebookUpload(notebookId, uploadId, {
      status: "chunking",
      stage: "chunk",
      progress: 30,
      sourceId: source.id,
    });

    const indexResult = await indexNotebookEmbeddings(notebookId, {
      onProgress: (event) => {
        if (event.type === "chunk_started") {
          void updateNotebookUpload(notebookId, uploadId, {
            status: "chunking",
            stage: "chunk",
            progress: 35,
          });
        } else if (event.type === "chunk_completed") {
          void updateNotebookUpload(notebookId, uploadId, {
            status: "embedding",
            stage: "embed",
            progress: 45,
          });
        } else if (event.type === "index_progress") {
          const progress = event.total > 0
            ? Math.min(95, 45 + Math.round((event.done / event.total) * 45))
            : 45;
          void updateNotebookUpload(notebookId, uploadId, {
            status: event.message.toLowerCase().includes("writing") ? "persisting" : "embedding",
            stage: event.message.toLowerCase().includes("writing") ? "persist" : "embed",
            progress,
          });
        } else if (event.type === "persist_completed") {
          void updateNotebookUpload(notebookId, uploadId, {
            status: "persisting",
            stage: "persist",
            progress: 98,
          });
        }
        emit(event);
      },
    });

    if (indexResult.status === "failed") {
      throw new Error(indexResult.message);
    }

    const timing = {
      extractMs,
      storeMs: source.timing.storeMs,
      chunkMs: indexResult.chunkMs,
      embedMs: indexResult.embedMs,
      persistMs: indexResult.persistMs,
      totalMs: elapsed(totalStart),
    };
    await updateNotebookUpload(notebookId, uploadId, {
      status: "completed",
      stage: "complete",
      progress: 100,
      sourceId: source.id,
      completedAt: new Date().toISOString(),
    });
    emit({
      type: "upload_completed",
      source: {
        id: source.id,
        title: source.title,
        chunkCount: indexResult.unitCount,
        charCount: source.charCount,
        mode: indexResult.status === "ready" ? "indexed" : "raw-sources-only",
      },
      timing,
      metrics: {
        chunkCount: indexResult.unitCount,
        charCount: source.charCount,
        embeddedCount: indexResult.embeddedCount,
        mode: indexResult.status === "ready" ? "indexed" : "raw-sources-only",
        indexStatus: indexResult.status,
        storage: "supabase-postgres",
      },
    });
    return { status: "completed" as const, sourceId: source.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Upload processing failed";
    await updateNotebookUpload(notebookId, uploadId, {
      status: "failed",
      stage: "complete",
      progress: 0,
      errorMessage: message,
    });
    emit({ type: "error", message });
    throw err;
  }
}
