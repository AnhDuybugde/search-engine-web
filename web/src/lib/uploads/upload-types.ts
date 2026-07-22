import { z } from "zod";
import { IR_DEFAULTS } from "@/lib/config";

export const uploadMetadataSchema = z.object({
  filename: z.string().trim().min(1).max(240),
  mime: z.string().trim().max(160).nullable().optional(),
  size: z.number().int().positive(),
  checksum: z.string().trim().max(128).optional(),
  idempotencyKey: z.string().trim().min(8).max(120).optional(),
});

export const uploadCompleteSchema = z.object({
  uploadId: z.string().uuid(),
});

const ALLOWED_EXTENSIONS = new Set([".pdf", ".txt", ".md", ".csv", ".json"]);

export function safeUploadFilename(filename: string): string {
  const base = filename.split(/[\\/]/).pop() || "upload";
  return base.replace(/[^a-zA-Z0-9._ -]/g, "_").slice(0, 180) || "upload";
}

export function validateUploadMetadata(input: z.infer<typeof uploadMetadataSchema>) {
  const safeFilename = safeUploadFilename(input.filename);
  const extension = safeFilename.includes(".")
    ? `.${safeFilename.split(".").pop()!.toLowerCase()}`
    : "";
  if (!ALLOWED_EXTENSIONS.has(extension)) {
    throw new Error("Unsupported type. Use PDF, TXT, MD, CSV, or JSON.");
  }
  if (input.size > IR_DEFAULTS.maxUploadBytes) {
    throw new Error(
      `File too large (max ${IR_DEFAULTS.maxUploadBytes} bytes).`,
    );
  }
  return { safeFilename, extension };
}

export type UploadStatus =
  | "pending"
  | "uploading"
  | "uploaded"
  | "queued"
  | "extracting"
  | "stored"
  | "chunking"
  | "embedding"
  | "persisting"
  | "completed"
  | "failed"
  | "cancelled"
  | "expired";

export type UploadStage =
  | "created"
  | "upload"
  | "extract"
  | "store"
  | "chunk"
  | "embed"
  | "persist"
  | "complete";

export type NotebookUpload = {
  id: string;
  notebookId: string;
  storageBucket: string;
  storagePath: string;
  originalFilename: string;
  safeFilename: string;
  mime: string | null;
  byteSize: number;
  checksum: string | null;
  status: UploadStatus;
  stage: UploadStage;
  progress: number;
  sourceId: string | null;
  errorMessage: string | null;
  retryCount: number;
  idempotencyKey: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};
