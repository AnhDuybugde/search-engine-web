"use client";

import type { Metrics, Timing } from "@/lib/ir/types";

function fmtMs(ms?: number | null) {
  if (ms == null || !Number.isFinite(ms)) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function modeLabel(mode?: string) {
  switch (mode) {
    case "adaptive_rrf":
      return "Hybrid RRF";
    case "bm25_fallback":
      return "BM25 fallback";
    case "bm25":
      return "BM25";
    default:
      return mode || "—";
  }
}

export function RunMetricsStrip({
  timing,
  metrics,
}: {
  timing: Timing | null;
  metrics: Metrics | null;
}) {
  if (!timing && !metrics) {
    return (
      <p className="text-xs text-[var(--fg-subtle)]">
        Run a query to see query time, rank time, confidence, and total latency.
      </p>
    );
  }

  const items: { label: string; value: string }[] = [
    { label: "Total", value: fmtMs(timing?.totalMs) },
    { label: "Query", value: fmtMs(timing?.queryProcessMs) },
    {
      label: "Rank",
      value: fmtMs(timing?.rankMs ?? timing?.retrieveMs),
    },
    { label: "BM25", value: fmtMs(timing?.bm25Ms) },
    { label: "Embed (query)", value: fmtMs(timing?.embeddingMs) },
    { label: "Pack", value: fmtMs(timing?.packMs) },
    { label: "Generate", value: fmtMs(timing?.generateMs) },
  ];

  if (timing?.ttftMs != null) {
    items.push({ label: "TTFT", value: fmtMs(timing.ttftMs) });
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {items.map((item) => (
          <span
            key={item.label}
            className="inline-flex items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] px-2 py-1 font-mono text-[10px] text-[var(--fg-muted)]"
          >
            <span className="text-[var(--fg-subtle)]">{item.label}</span>
            <span className="font-semibold text-[var(--fg)]">{item.value}</span>
          </span>
        ))}
      </div>
      <div className="flex flex-wrap gap-1.5 text-[11px] text-[var(--fg-muted)]">
        <span className="rounded-md bg-[var(--primary-soft)] px-2 py-0.5 font-medium text-[var(--primary)]">
          {modeLabel(metrics?.retrievalMode)}
        </span>
        {metrics?.confidenceMax != null && (
          <span className="rounded-md border border-[var(--border)] px-2 py-0.5 font-mono">
            conf_max={(metrics.confidenceMax * 100).toFixed(0)}%
          </span>
        )}
        {metrics?.confidenceMean != null && (
          <span className="rounded-md border border-[var(--border)] px-2 py-0.5 font-mono">
            conf_mean={(metrics.confidenceMean * 100).toFixed(0)}%
          </span>
        )}
        {metrics?.scoreMargin != null && (
          <span className="rounded-md border border-[var(--border)] px-2 py-0.5 font-mono">
            margin={(metrics.scoreMargin * 100).toFixed(0)}%
          </span>
        )}
        {metrics?.documentsRanked != null && (
          <span className="rounded-md border border-[var(--border)] px-2 py-0.5 font-mono">
            docs={metrics.documentsRanked}
          </span>
        )}
        {metrics?.chunkCount != null && (
          <span
            className="rounded-md border border-[var(--border)] px-2 py-0.5 font-mono"
            title="Ephemeral retrieval units built at query time (not stored chunk rows)"
          >
            units={metrics.chunkCount}
          </span>
        )}
        {metrics?.bm25Weight != null && (
          <span className="rounded-md border border-[var(--border)] px-2 py-0.5 font-mono">
            w_BM25={metrics.bm25Weight.toFixed(2)}
          </span>
        )}
      </div>
    </div>
  );
}
