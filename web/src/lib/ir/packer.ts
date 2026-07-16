import { domainOf } from "@/lib/utils";
import type { RankedChunk } from "./types";

/**
 * Diversify context: max chunks overall, max per source domain/document.
 */
export function packContext(
  ranked: RankedChunk[],
  maxTotal = 5,
  maxPerSource = 2,
): RankedChunk[] {
  const picked: RankedChunk[] = [];
  const perKey = new Map<string, number>();

  for (const item of ranked) {
    if (picked.length >= maxTotal) break;
    const key = item.url ? domainOf(item.url) : item.documentId;
    const count = perKey.get(key) || 0;
    if (count >= maxPerSource) continue;
    perKey.set(key, count + 1);
    picked.push(item);
  }

  return picked.map((c, i) => ({
    ...c,
    finalRank: i + 1,
    citationId: i + 1,
  }));
}
