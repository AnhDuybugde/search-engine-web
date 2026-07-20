"use client";

import { ChevronRight, FileText } from "lucide-react";
import type { RankedDocument } from "@/lib/ir/types";
import { cn } from "@/lib/utils";

function confPct(c: number) {
  return Math.round(Math.max(0, Math.min(1, c)) * 100);
}

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
      <div className="rounded-xl border border-dashed border-[var(--border-strong)] bg-[var(--bg-panel)] px-4 py-6 text-center">
        <p className="text-sm font-medium text-[var(--fg-muted)]">
          No ranked documents yet
        </p>
        <p className="mt-1 text-xs leading-relaxed text-[var(--fg-subtle)]">
          Run a query — top matches appear here with score and match strength.
        </p>
      </div>
    );
  }

  return (
    <ol className="space-y-2">
      {documents.map((doc) => {
        const active = activeId === doc.documentId;
        const pct = confPct(doc.confidence);
        return (
          <li key={doc.documentId}>
            <button
              type="button"
              onClick={() => onSelect(doc)}
              className={cn(
                "group flex w-full items-stretch gap-0 overflow-hidden rounded-xl border text-left transition-all",
                active
                  ? "border-[var(--primary-border)] bg-[var(--primary-soft)] shadow-sm ring-1 ring-[var(--primary-border)]"
                  : "border-[var(--border)] bg-[var(--bg-elevated)] hover:border-[var(--border-strong)] hover:bg-[var(--surface-hover)]",
              )}
            >
              {/* Rank stripe */}
              <span
                className={cn(
                  "flex w-11 shrink-0 flex-col items-center justify-center border-r border-[var(--border)] font-mono text-sm font-bold",
                  active
                    ? "bg-[var(--primary)] text-white"
                    : "bg-[var(--bg-panel)] text-[var(--fg-muted)]",
                )}
                aria-label={`Rank ${doc.finalRank}`}
              >
                {doc.finalRank}
              </span>

              <span className="min-w-0 flex-1 px-3 py-3">
                <span className="flex items-start gap-2">
                  <FileText
                    className={cn(
                      "mt-0.5 h-4 w-4 shrink-0",
                      active ? "text-[var(--primary)]" : "text-[var(--fg-subtle)]",
                    )}
                    aria-hidden
                  />
                  <span className="min-w-0">
                    <span className="line-clamp-2 text-[13.5px] font-semibold leading-snug text-[var(--fg)]">
                      {doc.title}
                    </span>
                    {doc.snippet && (
                      <span className="mt-1 line-clamp-2 text-[12px] leading-relaxed text-[var(--fg-muted)]">
                        {doc.snippet}
                      </span>
                    )}
                  </span>
                </span>

                {/* Confidence (score proxy for this query — not calibrated %) */}
                <span className="mt-2.5 block">
                  <span className="mb-1 flex items-center justify-between text-[11px]">
                    <span
                      className="font-medium text-[var(--fg-muted)]"
                      title="Display proxy from this query's retrieval scores (BM25/dense/final + margin). Not a calibrated ML probability."
                    >
                      Match strength
                    </span>
                    <span className="font-semibold tabular-nums text-[var(--fg)]">
                      {pct}%
                    </span>
                  </span>
                  <span
                    className="block h-2 overflow-hidden rounded-full bg-[var(--bg-panel)] ring-1 ring-[var(--border)]"
                    aria-hidden
                  >
                    <span
                      className={cn(
                        "block h-full rounded-full transition-[width]",
                        pct >= 70
                          ? "bg-emerald-500"
                          : pct >= 40
                            ? "bg-[var(--primary)]"
                            : "bg-amber-500",
                      )}
                      style={{ width: `${pct}%` }}
                    />
                  </span>
                </span>

                {/* Score grid */}
                <span className="mt-2.5 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                  <MetricCell
                    label="Final"
                    value={doc.finalScore.toFixed(3)}
                    emphasis
                  />
                  {doc.bm25Best != null && Number.isFinite(doc.bm25Best) && (
                    <MetricCell label="BM25" value={doc.bm25Best.toFixed(2)} />
                  )}
                  {doc.denseBest != null && Number.isFinite(doc.denseBest) && (
                    <MetricCell label="Dense" value={doc.denseBest.toFixed(2)} />
                  )}
                  <MetricCell
                    label="Hits"
                    value={String(doc.chunkHits)}
                    title="Retrieval units that contributed to this document rank"
                  />
                </span>
              </span>

              <span className="flex shrink-0 items-center pr-2">
                <ChevronRight
                  className={cn(
                    "h-4 w-4 text-[var(--fg-subtle)] transition-transform group-hover:translate-x-0.5",
                    active && "text-[var(--primary)]",
                  )}
                />
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function MetricCell({
  label,
  value,
  emphasis,
  title,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "rounded-md border px-1.5 py-1 text-center",
        emphasis
          ? "border-[var(--primary-border)] bg-[var(--primary-soft)]"
          : "border-[var(--border)] bg-[var(--bg-panel)]",
      )}
    >
      <span className="block text-[9px] font-semibold uppercase tracking-wide text-[var(--fg-subtle)]">
        {label}
      </span>
      <span
        className={cn(
          "mt-0.5 block font-mono text-[11px] font-semibold tabular-nums",
          emphasis ? "text-[var(--primary)]" : "text-[var(--fg)]",
        )}
      >
        {value}
      </span>
    </span>
  );
}
