import { requireUserId } from "@/lib/auth";
import { listSourcesForIndex } from "@/lib/db/notebooks-repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STOP_WORDS = new Set([
  "a", "an", "and", "are", "for", "from", "how", "in", "is", "of",
  "on", "the", "to", "what", "with",
]);

function normalize(value: string) {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function countOccurrences(haystack: string, needle: string) {
  if (!needle) return 0;
  let count = 0;
  let cursor = 0;
  while ((cursor = haystack.indexOf(needle, cursor)) !== -1) {
    count += 1;
    cursor += needle.length;
    if (count >= 8) break;
  }
  return count;
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = requireUserId(req);
  if ("error" in auth) return auth.error;

  const { id } = await ctx.params;
  const query = new URL(req.url).searchParams.get("q")?.trim() || "";
  if (query.length < 2) return Response.json({ suggestions: [] });

  try {
    const terms = normalize(query)
      .split(/\s+/)
      .filter((term) => term.length >= 2 && !STOP_WORDS.has(term));
    if (!terms.length) return Response.json({ suggestions: [] });

    const sources = await listSourcesForIndex(id);
    const matches = sources
      .map((source) => {
        const title = normalize(source.title);
        const text = normalize(source.text);
        const titleHits = terms.reduce((sum, term) => sum + countOccurrences(title, term), 0);
        const contentHits = terms.reduce((sum, term) => sum + countOccurrences(text, term), 0);
        return { source, score: titleHits * 12 + Math.min(contentHits, 12) };
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || a.source.title.localeCompare(b.source.title))
      .slice(0, 5);

    const suggestions = matches.flatMap(({ source }) => [
      `Summarize ${source.title.trim()}`,
      `Find ${query} in ${source.title.trim()}`,
    ]);
    return Response.json({ suggestions: suggestions.slice(0, 5) });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Recommendation search failed" },
      { status: 500 },
    );
  }
}
