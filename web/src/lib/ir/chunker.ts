import { randomUUID } from "crypto";
import type { Chunk } from "./types";
import { IR_DEFAULTS } from "@/lib/config";

export type DocumentInput = {
  documentId: string;
  title: string;
  url?: string;
  text: string;
};

export function chunkDocument(
  doc: DocumentInput,
  chunkSizeWords = IR_DEFAULTS.chunkSizeWords,
  overlapWords = IR_DEFAULTS.chunkOverlapWords,
): Chunk[] {
  const words = doc.text
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);

  if (words.length === 0) return [];

  const chunks: Chunk[] = [];
  const step = Math.max(1, chunkSizeWords - overlapWords);
  let index = 0;

  for (let start = 0; start < words.length; start += step) {
    const slice = words.slice(start, start + chunkSizeWords);
    if (slice.length === 0) break;
    chunks.push({
      chunkId: randomUUID(),
      documentId: doc.documentId,
      title: doc.title,
      url: doc.url,
      text: slice.join(" "),
      chunkIndex: index++,
    });
    if (start + chunkSizeWords >= words.length) break;
  }

  return chunks;
}

export function chunkDocuments(docs: DocumentInput[]): Chunk[] {
  return docs.flatMap((d) => chunkDocument(d));
}
