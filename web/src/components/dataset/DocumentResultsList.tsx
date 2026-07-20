"use client";

import { ChevronRight, FileText } from "lucide-react";
import type { RankedDocument } from "@/lib/ir/types";
import { cn } from "@/lib/utils";

export function DocumentResultsList({
  documents,
  activeId,
  onSelect,
}: {
  documents: RankedDocument[];
  activeId?: string | null;
  onSelect: (doc: RankedDocument) => void;
}) {
  if (!documents.length) {
    return (
      <p className="text-sm text-[var(--fg-muted)]">
        Top 10 ranked documents will appear here after you run a query.
      </p>
    );
  }

  return (
    <ol className="divide-y divide-[var(--border)] rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)]">
      {documents.map((doc) => {
        const active = activeId === doc.documentId;
        return (
          <li key={doc.documentId}>
            <button
              type="button"
              onClick={() => onSelect(doc)}
              className={cn(
                "flex w-full items-start gap-3 px-3 py-3 text-left transition-colors",
                active
                  ? "bg-[var(--primary-soft)]"
                  : "hover:bg-[var(--surface-hover)]",
              )}
            >
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[var(--bg-panel)] font-mono text-[11px] font-semibold text-[var(--fg-muted)] ring-1 ring-[var(--border)]">
                {doc.finalRank}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-start gap-2">
                  <FileText
                    className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--primary)]"
                    aria-hidden
                  />
                  <span className="line-clamp-2 text-[13px] font-medium leading-snug text-[var(--fg)]">
                    {doc.title}
                  </span>
                </span>
                <span className="mt-1.5 flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[10px] text-[var(--fg-muted)]">
                    final {doc.finalScore.toFixed(3)}
                  </span>
                  {doc.bm25Best != null && Number.isFinite(doc.bm25Best) && (
                    <span className="font-mono text-[10px] text-[var(--fg-subtle)]">
                      BM25 {doc.bm25Best.toFixed(2)}
                    </span>
                  )}
                  {doc.denseBest != null && Number.isFinite(doc.denseBest) && (
                    <span className="font-mono text-[10px] text-[var(--fg-subtle)]">
                      dense {doc.denseBest.toFixed(2)}
                    </span>
                  )}
                  <span className="inline-flex items-center gap-1.5 text-[10px] text-[var(--fg-subtle)]">
                    conf {(doc.confidence * 100).toFixed(0)}%
                    <span
                      className="h-1.5 w-16 overflow-hidden rounded-full bg-[var(--bg-panel)] ring-1 ring-[var(--border)]"
                      aria-hidden
                    >
                      <span
                        className="block h-full rounded-full bg-[var(--primary)]"
                        style={{
                          width: `${Math.round(doc.confidence * 100)}%`,
                        }}
                      />
                    </span>
                  </span>
                  <span className="text-[10px] text-[var(--fg-subtle)]">
                    {doc.chunkHits} hit{doc.chunkHits === 1 ? "" : "s"}
                  </span>
                </span>
              </span>
              <ChevronRight
                className={cn(
                  "mt-1 h-4 w-4 shrink-0 text-[var(--fg-subtle)]",
                  active && "text-[var(--primary)]",
                )}
              />
            </button>
          </li>
        );
      })}
    </ol>
  );
}
