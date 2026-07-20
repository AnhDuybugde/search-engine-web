"use client";

import { useMemo, useState } from "react";
import {
  buildCandidateCompare,
  buildDocumentScoreSeries,
  buildRankTransitions,
  buildStageTimeline,
  buildTimingWaterfall,
  type StageVizRow,
  type WaterfallBar,
} from "@/lib/ir/pipeline-viz";
import type { Metrics, RankedChunk, RankedDocument, Timing } from "@/lib/ir/types";
import { cn } from "@/lib/utils";

function fmtMs(ms: number | null | undefined) {
  if (ms == null || !Number.isFinite(ms)) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

const BAR_COLORS: Record<WaterfallBar["color"], string> = {
  primary: "bg-[var(--primary)]",
  accent: "bg-[var(--accent)]",
  muted: "bg-slate-400",
  success: "bg-emerald-500",
  warn: "bg-amber-500",
};

export function ProcessExplainPanel({
  timing,
  metrics,
  documents,
  rankedChunks,
  packedChunks,
}: {
  timing: Timing | null;
  metrics: Metrics | null;
  documents: RankedDocument[];
  rankedChunks: RankedChunk[];
  packedChunks: RankedChunk[];
}) {
  const stages = useMemo(
    () => buildStageTimeline(timing, metrics),
    [timing, metrics],
  );
  const waterfall = useMemo(
    () => buildTimingWaterfall(timing, metrics),
    [timing, metrics],
  );
  const transitions = useMemo(
    () => buildRankTransitions(rankedChunks, 12),
    [rankedChunks],
  );
  const scoreSeries = useMemo(
    () => buildDocumentScoreSeries(documents),
    [documents],
  );
  const candidates = useMemo(
    () => buildCandidateCompare(rankedChunks, packedChunks, 15),
    [rankedChunks, packedChunks],
  );

  const [activeStage, setActiveStage] = useState<string | null>(null);
  const selected: StageVizRow | undefined =
    stages.find((s) => s.id === activeStage) ||
    stages.find((s) => s.outcome === "ran") ||
    stages[0];

  if (!timing && !metrics && !documents.length && !rankedChunks.length) {
    return (
      <p className="text-sm text-[var(--fg-muted)]">
        Run a search to open the full IR process lab: stage explanations, timing
        waterfall, rank transitions (BM25 → dense → final), and score bars.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      {/* Stage explanations */}
      <div>
        <h3 className="section-title">How the engine ran</h3>
        <p className="mb-3 text-xs leading-relaxed text-[var(--fg-muted)]">
          Click a stage for a teachable explanation. Durations come from the live
          pipeline timing fields (queryProcessMs, bm25Ms, embeddingMs, …).
        </p>
        <ol className="space-y-1.5">
          {stages.map((stage) => {
            const active = selected?.id === stage.id;
            return (
              <li key={stage.id}>
                <button
                  type="button"
                  onClick={() => setActiveStage(stage.id)}
                  className={cn(
                    "flex w-full items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors",
                    active
                      ? "border-[var(--primary-border)] bg-[var(--primary-soft)]"
                      : "border-[var(--border)] bg-[var(--surface)] hover:border-[var(--border-strong)]",
                  )}
                >
                  <OutcomePill outcome={stage.outcome} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className="text-[13px] font-semibold text-[var(--fg)]">
                        {stage.label}
                      </span>
                      <span className="shrink-0 font-mono text-[11px] text-[var(--fg-muted)]">
                        {fmtMs(stage.ms)}
                      </span>
                    </span>
                    {stage.detail && (
                      <span className="mt-0.5 block text-[11px] text-[var(--fg-subtle)]">
                        {stage.detail}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
        {selected && (
          <div className="mt-3 rounded-lg border border-[var(--border)] bg-[var(--bg-panel)] p-3 text-xs leading-relaxed text-[var(--fg-muted)]">
            <p className="font-semibold text-[var(--fg)]">{selected.label}</p>
            <p className="mt-1">{selected.explanation}</p>
            {selected.detail && (
              <p className="mt-2 font-mono text-[10px] text-[var(--fg-subtle)]">
                {selected.detail}
                {selected.ms != null ? ` · ${fmtMs(selected.ms)}` : ""}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Timing waterfall — extra viz #1 */}
      {waterfall.length > 0 && (
        <div>
          <h3 className="section-title">Timing waterfall</h3>
          <p className="mb-2 text-[11px] text-[var(--fg-muted)]">
            Sequential stage cost as a share of total wall time (
            {fmtMs(timing?.totalMs)}). Use this to show where latency lives.
          </p>
          <ul className="space-y-2">
            {waterfall.map((bar) => (
              <li key={bar.id} className="grid grid-cols-[4.5rem_1fr_3rem] items-center gap-2">
                <span className="text-[11px] font-medium text-[var(--fg-muted)]">
                  {bar.label}
                </span>
                <div className="relative h-3 overflow-hidden rounded-full bg-[var(--bg-panel)] ring-1 ring-[var(--border)]">
                  <div
                    className={cn(
                      "absolute top-0 h-full rounded-full opacity-90",
                      BAR_COLORS[bar.color],
                    )}
                    style={{
                      left: `${bar.offsetFraction * 100}%`,
                      width: `${Math.max(bar.fraction * 100, bar.ms > 0 ? 1.5 : 0)}%`,
                    }}
                    title={`${bar.label}: ${fmtMs(bar.ms)}`}
                  />
                </div>
                <span className="text-right font-mono text-[10px] text-[var(--fg-subtle)]">
                  {fmtMs(bar.ms)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Document score bars — extra viz #2 */}
      {scoreSeries.length > 0 && (
        <div>
          <h3 className="section-title">Top documents — score & confidence</h3>
          <p className="mb-2 text-[11px] text-[var(--fg-muted)]">
            Final score (relative bar) and normalized confidence. Confidence is a
            display score, not a calibrated probability.
          </p>
          <ul className="space-y-2.5">
            {scoreSeries.map((row) => (
              <li key={row.documentId} className="space-y-1">
                <div className="flex items-center justify-between gap-2 text-[12px]">
                  <span className="min-w-0 truncate font-medium text-[var(--fg)]">
                    <span className="mr-1.5 font-mono text-[10px] text-[var(--fg-subtle)]">
                      #{row.finalRank}
                    </span>
                    {row.title}
                  </span>
                  <span className="shrink-0 font-mono text-[10px] text-[var(--fg-muted)]">
                    {row.finalScore.toFixed(3)} · conf{" "}
                    {(row.confidence * 100).toFixed(0)}%
                  </span>
                </div>
                <div className="space-y-1">
                  <div className="h-2 overflow-hidden rounded-full bg-[var(--bg-panel)] ring-1 ring-[var(--border)]">
                    <div
                      className="h-full rounded-full bg-[var(--primary)]"
                      style={{ width: `${row.scoreFraction * 100}%` }}
                    />
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-[var(--bg-panel)] ring-1 ring-[var(--border)]">
                    <div
                      className="h-full rounded-full bg-[var(--accent)]"
                      style={{ width: `${row.confFraction * 100}%` }}
                    />
                  </div>
                </div>
              </li>
            ))}
          </ul>
          <div className="mt-1.5 flex gap-3 text-[10px] text-[var(--fg-subtle)]">
            <span className="inline-flex items-center gap-1">
              <span className="h-1.5 w-3 rounded bg-[var(--primary)]" /> Score
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-1.5 w-3 rounded bg-[var(--accent)]" /> Confidence
            </span>
          </div>
        </div>
      )}

      {/* Rank transition table — extra viz #3 (core “how ranking changed”) */}
      {transitions.length > 0 && (
        <div>
          <h3 className="section-title">Rank transitions (retrieval units)</h3>
          <p className="mb-2 text-[11px] text-[var(--fg-muted)]">
            BM25 rank → dense rank → final fused rank. Δ = improvement vs BM25
            (positive means fusion/dense helped the unit rise).
          </p>
          <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
            <table className="w-full min-w-[32rem] border-collapse text-left text-[11px]">
              <thead className="bg-[var(--bg-panel)] text-[var(--fg-subtle)]">
                <tr>
                  <th className="px-2 py-1.5 font-medium">Title</th>
                  <th className="px-2 py-1.5 font-medium">BM25#</th>
                  <th className="px-2 py-1.5 font-medium">Dense#</th>
                  <th className="px-2 py-1.5 font-medium">Final#</th>
                  <th className="px-2 py-1.5 font-medium">Δ</th>
                  <th className="px-2 py-1.5 font-medium">Scores</th>
                </tr>
              </thead>
              <tbody>
                {transitions.map((row) => (
                  <tr
                    key={row.chunkId}
                    className="border-t border-[var(--border)]"
                  >
                    <td className="max-w-[10rem] truncate px-2 py-1.5 font-medium text-[var(--fg)]">
                      {row.title}
                    </td>
                    <td className="px-2 py-1.5 font-mono">
                      {row.bm25Rank ?? "—"}
                    </td>
                    <td className="px-2 py-1.5 font-mono">
                      {row.denseRank ?? "—"}
                    </td>
                    <td className="px-2 py-1.5 font-mono font-semibold">
                      {row.finalRank}
                    </td>
                    <td
                      className={cn(
                        "px-2 py-1.5 font-mono",
                        row.rankDeltaFromBm25 != null &&
                          row.rankDeltaFromBm25 > 0 &&
                          "text-emerald-700",
                        row.rankDeltaFromBm25 != null &&
                          row.rankDeltaFromBm25 < 0 &&
                          "text-rose-700",
                      )}
                    >
                      {row.rankDeltaFromBm25 == null
                        ? "—"
                        : row.rankDeltaFromBm25 > 0
                          ? `+${row.rankDeltaFromBm25}`
                          : String(row.rankDeltaFromBm25)}
                    </td>
                    <td className="px-2 py-1.5 font-mono text-[10px] text-[var(--fg-muted)]">
                      b={row.bm25Score.toFixed(2)}
                      {row.denseScore != null
                        ? ` · d=${row.denseScore.toFixed(2)}`
                        : ""}
                      {` · f=${row.finalScore.toFixed(3)}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Packed vs ranked pool */}
      {candidates.length > 0 && (
        <div>
          <h3 className="section-title">Candidates vs packed context</h3>
          <p className="mb-2 text-[11px] text-[var(--fg-muted)]">
            Ranking pool vs what the packer sent to the LLM. Pack diversifies
            sources — a high-rank hit can be excluded if another unit from the
            same document was already chosen.
          </p>
          <ul className="max-h-40 space-y-1 overflow-y-auto text-[11px]">
            {candidates.map((c) => (
              <li
                key={c.chunkId}
                className="flex items-center justify-between gap-2 rounded border border-[var(--border)] px-2 py-1"
              >
                <span className="min-w-0 truncate">
                  <span className="font-mono text-[var(--fg-subtle)]">
                    #{c.finalRank}
                  </span>{" "}
                  {c.title}
                </span>
                <span
                  className={cn(
                    "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium",
                    c.inPacked
                      ? "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-600/20"
                      : "bg-[var(--bg-panel)] text-[var(--fg-subtle)]",
                  )}
                >
                  {c.inPacked ? "in pack" : "ranked only"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function OutcomePill({
  outcome,
}: {
  outcome: StageVizRow["outcome"];
}) {
  const label =
    outcome === "ran"
      ? "ran"
      : outcome === "skipped"
        ? "skip"
        : outcome === "failed"
          ? "fail"
          : "…";
  return (
    <span
      className={cn(
        "mt-0.5 inline-flex h-5 min-w-[2.25rem] items-center justify-center rounded px-1 text-[10px] font-semibold uppercase tracking-wide",
        outcome === "ran" && "bg-emerald-50 text-emerald-800",
        outcome === "skipped" && "bg-slate-100 text-slate-600",
        outcome === "failed" && "bg-rose-50 text-rose-700",
        outcome === "idle" && "bg-[var(--bg-panel)] text-[var(--fg-subtle)]",
      )}
    >
      {label}
    </span>
  );
}
