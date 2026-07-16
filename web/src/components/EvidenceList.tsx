import { ExternalLink } from "lucide-react";
import type { RankedChunk } from "@/lib/ir/types";

export function EvidenceList({
  results,
  activeId,
  onHover,
}: {
  results: RankedChunk[];
  activeId?: number | null;
  onHover?: (id: number | null) => void;
}) {
  if (!results.length) {
    return (
      <p className="text-sm text-[var(--fg-muted)]">
        No evidence yet. Run a query to see ranked chunks.
      </p>
    );
  }

  return (
    <ul className="space-y-3">
      {results.map((r) => (
        <li
          key={r.chunkId}
          onMouseEnter={() => onHover?.(r.citationId)}
          onMouseLeave={() => onHover?.(null)}
          className={`rounded-2xl border p-3.5 transition duration-200 ${
            activeId === r.citationId
              ? "border-indigo-400/45 bg-indigo-500/10"
              : "border-white/10 bg-black/20 hover:border-white/20"
          }`}
        >
          <div className="mb-1.5 flex items-start justify-between gap-2">
            <div className="text-sm font-medium text-[var(--fg)]">
              <span className="mr-2 inline-flex h-6 min-w-6 items-center justify-center rounded-md bg-indigo-500/20 px-1.5 text-xs font-semibold text-indigo-200">
                [{r.citationId}]
              </span>
              {r.title}
            </div>
            <span className="shrink-0 rounded-md bg-white/5 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[var(--fg-muted)]">
              BM25 #{r.bm25Rank}
            </span>
          </div>
          {r.url && (
            <a
              href={r.url}
              target="_blank"
              rel="noreferrer"
              className="mb-2 inline-flex max-w-full items-center gap-1 truncate text-xs text-emerald-300/90 hover:underline"
            >
              <span className="truncate">
                {r.url.replace(/^https?:\/\//, "").slice(0, 64)}
              </span>
              <ExternalLink className="h-3 w-3 shrink-0" aria-hidden />
            </a>
          )}
          <p className="line-clamp-4 text-xs leading-relaxed text-[var(--fg-muted)]">
            {r.text}
          </p>
          <div className="mt-2 font-mono text-[10px] text-[var(--fg-muted)]/80">
            score {Number.isFinite(r.bm25Score) ? r.bm25Score.toFixed(3) : "—"}
          </div>
        </li>
      ))}
    </ul>
  );
}
