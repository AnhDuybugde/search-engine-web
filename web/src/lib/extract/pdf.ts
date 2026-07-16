/**
 * Server-side PDF text extraction via unpdf (no pdf.worker.mjs bundling issues).
 */
export async function extractPdfText(buffer: Buffer): Promise<string> {
  const { extractText } = await import("unpdf");
  const data = new Uint8Array(buffer);
  const result = await extractText(data, { mergePages: true });

  const raw = result.text;
  const text = Array.isArray(raw) ? raw.join("\n\n") : String(raw ?? "");
  const cleaned = text.replace(/\u0000/g, "").replace(/[ \t]+\n/g, "\n").trim();

  if (!cleaned) {
    throw new Error(
      "PDF has no extractable text (may be scanned/image-only). Try TXT/MD or OCR first.",
    );
  }
  return cleaned;
}
