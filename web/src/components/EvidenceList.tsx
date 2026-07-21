"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, ExternalLink } from "lucide-react";
import type { RankedChunk } from "@/lib/ir/types";
import { cn } from "@/lib/utils";

function fmt(n: number | undefined | null, digits = 3) {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toFixed(digits);
}

export function EvidenceList({
  results,
  activeId,
  onHover,
  compact = false,
}: {
  results: RankedChunk[];
  activeId?: number | null;
  onHover?: (id: number | null) => void;
  compact?: boolean;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);

  if (!results.length) {
    return (
      <p className="text-sm text-[var(--fg-muted)]">
        No evidence yet. Run a query to see ranked retrieval hits.
      </p>
    );
  }

  return (
    <ul className="space-y-2.5">
      {results.map((r) => {
        const isOpen = expanded === r.chunkId;
        const hybrid =
          r.retrievalMode === "adaptive_rrf" ||
          r.retrievalMode === "legacy_rrf_ce" ||
          r.denseScore != null ||
          r.denseRank != null;

        return (
          <li
            key={r.chunkId}
            onMouseEnter={() => onHover?.(r.citationId)}
            onMouseLeave={() => onHover?.(null)}
            className={cn(
              "hover-lift rounded-xl border p-3 transition-colors duration-150",
              activeId === r.citationId
                ? "border-[var(--mood-border)] bg-[var(--mood-soft)]"
                : "border-[var(--border)] bg-[var(--surface)] hover:border-[var(--mood-border)]",
            )}
          >
            <div className="mb-1.5 flex items-start justify-between gap-2">
              <div className="text-[13px] font-medium leading-snug text-[var(--fg)]">
                <span className="mr-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded bg-[var(--mood-soft)] px-1 text-[11px] font-semibold text-[var(--mood)] ring-1 ring-[var(--mood-border)]">
                  [{r.citationId}]
                </span>
                {r.title}
              </div>
              <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--fg-subtle)]">
                {hybrid ? `Final #${r.finalRank}` : `BM25 #${r.bm25Rank}`}
              </span>
            </div>

            {r.url && (
              <a
                href={r.url}
                target="_blank"
                rel="noreferrer"
                className="mb-1.5 inline-flex max-w-full items-center gap-1 truncate text-xs text-[var(--accent)] hover:underline"
              >
                <span className="truncate">
                  {r.url.replace(/^https?:\/\//, "").slice(0, 64)}
                </span>
                <ExternalLink className="h-3 w-3 shrink-0" aria-hidden />
              </a>
            )}

            <p
              className={cn(
                "text-xs leading-relaxed text-[var(--fg-muted)]",
                !isOpen && (compact ? "line-clamp-3" : "line-clamp-4"),
              )}
            >
              {r.text}
            </p>

            {r.text.length > 180 && (
              <button
                type="button"
                className="mt-1 inline-flex items-center gap-0.5 text-[11px] font-medium text-[var(--mood)] hover:underline"
                onClick={() =>
                  setExpanded((cur) => (cur === r.chunkId ? null : r.chunkId))
                }
              >
                {isOpen ? (
                  <>
                    Collapse <ChevronUp className="h-3 w-3" />
                  </>
                ) : (
                  <>
                    Expand <ChevronDown className="h-3 w-3" />
                  </>
                )}
              </button>
            )}

            {/* Score breakdown — visible engine ranking */}
            <div className="mt-2 flex flex-wrap gap-1.5 font-mono text-[10px]">
              <ScorePill
                label="BM25"
                rank={r.bm25Rank}
                score={r.bm25Score}
              />
              {hybrid && (
                <ScorePill
                  label="Dense"
                  rank={r.denseRank}
                  score={r.denseScore}
                />
              )}
              <ScorePill
                label={hybrid ? "RRF" : "Final"}
                rank={r.finalRank}
                score={r.finalScore ?? r.bm25Score}
                emphasis
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function ScorePill({
  label,
  rank,
  score,
  emphasis,
}: {
  label: string;
  rank?: number;
  score?: number;
  emphasis?: boolean;
}) {
  return (
    <span
      className={cn(
        "rounded border px-1.5 py-0.5",
        emphasis
          ? "border-[var(--primary-border)] bg-[var(--primary-soft)] text-[var(--primary)]"
          : "border-[var(--border)] bg-[var(--bg-elevated)] text-[var(--fg-muted)]",
      )}
    >
      {label}
      {rank != null ? ` #${rank}` : ""} · {fmt(score)}
    </span>
  );
}
