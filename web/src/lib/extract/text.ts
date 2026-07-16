export function extractPlainText(
  filename: string,
  buffer: Buffer,
  mime?: string | null,
): string {
  const lower = filename.toLowerCase();
  const isText =
    lower.endsWith(".txt") ||
    lower.endsWith(".md") ||
    lower.endsWith(".markdown") ||
    lower.endsWith(".csv") ||
    lower.endsWith(".json") ||
    lower.endsWith(".log") ||
    mime?.startsWith("text/") ||
    mime === "application/json";

  if (!isText) {
    throw new Error(
      `Unsupported type: ${filename}. Use PDF, TXT, MD, CSV, or JSON.`,
    );
  }

  // Strip UTF-8 BOM if present
  let text = buffer.toString("utf-8");
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return text.replace(/\u0000/g, "").trim();
}
