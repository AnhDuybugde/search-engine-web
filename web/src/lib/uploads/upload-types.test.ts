import { describe, expect, it } from "vitest";
import {
  safeUploadFilename,
  uploadCompleteSchema,
  uploadMetadataSchema,
  validateUploadMetadata,
} from "./upload-types";

describe("direct upload contracts", () => {
  it("removes path traversal and unsafe filename characters", () => {
    expect(safeUploadFilename("../../paper final?.pdf")).toBe("paper final_.pdf");
  });

  it("accepts supported metadata and returns a safe filename", () => {
    const parsed = uploadMetadataSchema.parse({
      filename: "paper.pdf",
      mime: "application/pdf",
      size: 1024,
      idempotencyKey: "client-upload-123",
    });
    expect(validateUploadMetadata(parsed).safeFilename).toBe("paper.pdf");
  });

  it("rejects unsupported extensions and oversized metadata", () => {
    const unsupported = uploadMetadataSchema.parse({
      filename: "archive.exe",
      size: 1024,
    });
    expect(() => validateUploadMetadata(unsupported)).toThrow(/Unsupported type/);

    const oversized = uploadMetadataSchema.parse({
      filename: "paper.pdf",
      size: 16 * 1024 * 1024,
    });
    expect(() => validateUploadMetadata(oversized)).toThrow(/File too large/);
  });

  it("requires a UUID when finalizing an upload", () => {
    expect(uploadCompleteSchema.safeParse({ uploadId: "not-a-uuid" }).success).toBe(false);
    expect(
      uploadCompleteSchema.safeParse({ uploadId: "00000000-0000-4000-8000-000000000001" }).success,
    ).toBe(true);
  });
});
