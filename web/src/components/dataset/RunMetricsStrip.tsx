"use client";

import type { Metrics, Timing } from "@/lib/ir/types";

function fmtMs(ms?: number | null) {
  if (ms == null || !Number.isFinite(ms)) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function modeLabel(mode?: string) {
  switch (mode) {
    case "rrf":
    case "adaptive_rrf":
      return "Hybrid RRF (classic)";
    case "bm25_fallback":
      return "BM25 fallback";
    case "bm25":
      return "BM25 only";
    default:
      return mode || "—";
  }
}

function pct(n?: number | null) {
  if (n == null || !Number.isFinite(n)) return null;
  return `${Math.round(n * 100)}%`;
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
      <div className="rounded-xl border border-dashed border-[var(--border-strong)] bg-[var(--bg-panel)] px-3 py-4 text-center">
        <p className="text-xs font-medium text-[var(--fg-muted)]">
          Run metrics appear after a search
        </p>
        <p className="mt-0.5 text-[11px] text-[var(--fg-subtle)]">
          Latency, retrieval mode, and relative score in one place.
        </p>
      </div>
    );
  }

  const latency: { label: string; value: string; hint?: string }[] = [
    { label: "Total", value: fmtMs(timing?.totalMs), hint: "End-to-end wall time" },
    { label: "Query", value: fmtMs(timing?.queryProcessMs) },
    {
      label: "Rank",
      value: fmtMs(timing?.rankMs ?? timing?.retrieveMs),
      hint: "BM25 + dense + fusion",
    },
    { label: "BM25", value: fmtMs(timing?.bm25Ms) },
    {
      label: "Embed",
      value: fmtMs(timing?.embeddingMs),
      hint: "Query-time dense vectors (not stored at upload)",
    },
    { label: "Pack", value: fmtMs(timing?.packMs) },
    { label: "Answer", value: fmtMs(timing?.generateMs) },
  ];
  if (timing?.ttftMs != null) {
    latency.push({
      label: "TTFT",
      value: fmtMs(timing.ttftMs),
      hint: "Time to first token",
    });
  }

  const topStrength = pct(
    metrics?.topScoreStrength ?? metrics?.confidenceMax,
  );
  const relMean = pct(
    metrics?.relativeScoreMean ?? metrics?.confidenceMean,
  );
  const margin = pct(metrics?.scoreMargin);

  return (
    <div className="space-y-3">
      {/* Mode + quality — standard IR labels */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-3">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--fg-subtle)]">
          Retrieval quality
        </p>
        <p className="mt-0.5 text-[10px] leading-relaxed text-[var(--fg-subtle)]">
          Standard stack: Okapi BM25 (raw) · dense cosine [0,1] · classic RRF
          k=60 (rank fusion, ~0–0.033). Channels use different units — do not
          compare raw numbers across channels. Relative = score/best this query
          (not P(relevant)).
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center rounded-lg bg-[var(--primary-soft)] px-2.5 py-1 text-xs font-semibold text-[var(--primary)] ring-1 ring-[var(--primary-border)]">
            {modeLabel(metrics?.retrievalMode)}
          </span>
          {topStrength != null && (
            <QualityPill
              label="Top strength"
              value={topStrength}
              strong
              title="Top hit rank score / dual-list RRF ceiling 2/(k+1). Absolute hybrid quality of #1 — not relative-to-list (which is always 100% for #1)."
            />
          )}
          {relMean != null && (
            <QualityPill
              label="Mean relative"
              value={relMean}
              title="Average of (score_i / best score) across ranked documents"
            />
          )}
          {margin != null && (
            <QualityPill
              label="Score margin"
              value={margin}
              title="(top1 − top2) / top1 on rank score"
            />
          )}
          {metrics?.documentsRanked != null && (
            <QualityPill
              label="Documents"
              value={String(metrics.documentsRanked)}
            />
          )}
          {metrics?.chunkCount != null && (
            <QualityPill
              label="Units ranked"
              value={String(metrics.chunkCount)}
              title="Ephemeral retrieval units this run — not stored chunk rows"
            />
          )}
        </div>
      </div>

      {/* Latency grid */}
      <div>
        <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--fg-subtle)]">
          Latency
        </p>
        <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4">
          {latency.map((item) => (
            <div
              key={item.label}
              title={item.hint}
              className="rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-2 py-1.5 text-center"
            >
              <div className="text-[9px] font-semibold uppercase tracking-wide text-[var(--fg-subtle)]">
                {item.label}
              </div>
              <div className="mt-0.5 font-mono text-[12px] font-semibold tabular-nums text-[var(--fg)]">
                {item.value}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function QualityPill({
  label,
  value,
  strong,
  title,
}: {
  label: string;
  value: string;
  strong?: boolean;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={
        strong
          ? "inline-flex flex-col rounded-lg border border-[var(--primary-border)] bg-[var(--primary-soft)] px-2 py-1"
          : "inline-flex flex-col rounded-lg border border-[var(--border)] bg-[var(--bg-panel)] px-2 py-1"
      }
    >
      <span className="text-[9px] font-medium text-[var(--fg-subtle)]">
        {label}
      </span>
      <span
        className={
          strong
            ? "font-mono text-[12px] font-bold tabular-nums text-[var(--primary)]"
            : "font-mono text-[12px] font-semibold tabular-nums text-[var(--fg)]"
        }
      >
        {value}
      </span>
    </span>
  );
}
