"use client";

import { useEffect, useMemo, useState } from "react";
import { FileText, Loader2, X } from "lucide-react";
import type { RankedChunk, RankedDocument } from "@/lib/ir/types";
import { cn } from "@/lib/utils";

type SourceDetail = {
  id: string;
  title: string;
  text: string;
  charCount: number;
  mime: string | null;
  chunks: { chunkId: string; chunkIndex: number; text: string }[];
};

function relativePct(doc: { relativeScore?: number; confidence?: number }) {
  const c = doc.relativeScore ?? doc.confidence ?? 0;
  return Math.round(Math.max(0, Math.min(1, c)) * 100);
}

/** Soften dense CSV / long single lines for reading. */
function formatSourceBody(text: string, title: string, mime: string | null) {
  const isCsv =
    (mime && mime.includes("csv")) ||
    /\.csv$/i.test(title) ||
    (text.includes(",") && text.split("\n").length > 3);

  if (!isCsv) {
    return text.trim();
  }

  // Prefer line-per-record readability for CSV-like corpora
  return text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n\n");
}

export function DocumentDetailDrawer({
  notebookId,
  document,
  rankedChunks,
  open,
  onClose,
}: {
  notebookId?: string | null;
  document: RankedDocument | null;
  rankedChunks: RankedChunk[];
  open: boolean;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<SourceDetail | null>(null);

  /* eslint-disable react-hooks/set-state-in-effect -- reset/fetch state follows drawer selection. */
  useEffect(() => {
    if (!open || !document) {
      setSource(null);
      setError(null);
      return;
    }

    // Root /notebooks queries can aggregate checked datasets. Their ranked
    // chunks already contain the matched evidence, while the source-detail
    // endpoint needs one concrete notebook id. Keep the drawer useful in
    // aggregate mode by showing that evidence without a cross-dataset fetch.
    if (!notebookId) {
      setSource(null);
      setError(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setSource(null);

    void (async () => {
      try {
        // Query-time units use `${sourceId}#r12` / `#p3` — fetch parent source
        const sourceId = document.documentId.split("#")[0];
        const res = await fetch(
          `/api/notebooks/${notebookId}/sources/${sourceId}`,
          { cache: "no-store" },
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to load document");
        if (!cancelled) setSource(data.source as SourceDetail);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Load failed");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, document, notebookId]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const contributing = useMemo(() => {
    if (!document) return [];
    const baseId = document.documentId.split("#")[0];
    return rankedChunks.filter(
      (c) =>
        c.documentId === document.documentId ||
        c.documentId === baseId ||
        c.documentId.startsWith(`${baseId}#`) ||
        document.topChunkIds.includes(c.chunkId),
    );
  }, [document, rankedChunks]);

  /** Prefer the ranked claim/paragraph unit over the whole raw file. */
  const unitText = useMemo(() => {
    if (!document) return null;
    const hit =
      rankedChunks.find((c) => c.documentId === document.documentId) ||
      rankedChunks.find((c) => document.topChunkIds.includes(c.chunkId));
    const t = hit?.text?.trim();
    return t && t.length >= 24 ? t : null;
  }, [document, rankedChunks]);

  const body = useMemo(() => {
    if (unitText) return unitText;
    if (!source) return "";
    return formatSourceBody(source.text, source.title, source.mime);
  }, [source, unitText]);

  if (!open || !document) return null;

  const pct = relativePct(document);
  const isRaw =
    source != null && (source.chunks?.length ?? 0) === 0;
  const showingUnit = Boolean(unitText);

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal>
      <button
        type="button"
        className="absolute inset-0 bg-slate-900/35 backdrop-blur-[2px]"
        aria-label="Close document detail"
        onClick={onClose}
      />
      <aside className="relative flex h-full w-full max-w-2xl flex-col border-l border-[var(--border)] bg-[var(--bg-elevated)] shadow-[var(--shadow-md)]">
        {/* Header */}
        <header className="shrink-0 border-b border-[var(--border)] px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--fg-subtle)]">
                Ranked document · #{document.finalRank}
              </p>
              <h2 className="mt-1 flex items-start gap-2 text-lg font-semibold leading-snug tracking-tight text-[var(--fg)]">
                <FileText
                  className="mt-0.5 h-5 w-5 shrink-0 text-[var(--primary)]"
                  aria-hidden
                />
                <span className="min-w-0 break-words">{document.title}</span>
              </h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="btn-ghost !min-h-9 !rounded-lg !px-2"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Score cards — readable grid */}
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
            <ScoreCard
              label="Relative score"
              value={`${pct}%`}
              accent
              bar={pct}
              hint="score / best score in this ranking (RRF ceiling if sole hybrid hit). Not P(relevant)."
            />
            <ScoreCard
              label="RRF (rank fusion)"
              value={formatScore(document.finalScore, 4)}
              hint="Classic RRF Σ 1/(k+rank), k=60 — typically ~0–0.033. Different unit from BM25/dense."
            />
            <ScoreCard
              label="BM25 (raw)"
              value={formatScore(document.bm25Best, 3)}
              hint="Okapi BM25 raw lexical score (≈0–15+). Not comparable to RRF or cosine. Missing values are shown as 0."
            />
            <ScoreCard
              label="Dense (cosine)"
              value={formatScore(document.denseBest, 3)}
              hint="Embedding cosine similarity in [0, 1]. Not comparable to BM25 or RRF. Missing values are shown as 0."
            />
            <ScoreCard
              label="Retrieval hits"
              value={formatScore(document.chunkHits, 0)}
              hint="Units of this doc in the fused top-K (not full corpus)"
            />
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {loading && (
            <div className="flex items-center gap-2 py-8 text-sm text-[var(--fg-muted)]">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading full source…
            </div>
          )}
          {error && (
            <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-[var(--danger)]">
              {error}
            </p>
          )}

          {(source || unitText) && (
            <div className="space-y-6">
              {/* Full content */}
              <section>
                <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-semibold text-[var(--fg)]">
                      {showingUnit ? "Matched unit (claim / record)" : "Full source text"}
                    </h3>
                    <p className="mt-0.5 text-[11px] text-[var(--fg-subtle)]">
                      {showingUnit
                        ? `${body.length.toLocaleString()} characters · split at query time from raw source`
                      : source
                        ? `${source.charCount.toLocaleString()} characters · ${
                            isRaw
                              ? "Stored as raw full text (no pre-indexed chunks)"
                              : `${source.chunks.length} stored chunk row${source.chunks.length === 1 ? "" : "s"}`
                          }`
                        : "Matched evidence returned by the aggregate retrieval run"}
                    </p>
                  </div>
                  {isRaw && (
                    <span className="rounded-md border border-[var(--border)] bg-[var(--bg-panel)] px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wide text-[var(--fg-muted)]">
                      {showingUnit ? "unit" : "raw"}
                    </span>
                  )}
                </div>
                <div className="max-h-[min(48vh,28rem)] overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--bg-panel)] px-4 py-3.5 shadow-inner">
                  <pre className="whitespace-pre-wrap break-words font-sans text-[13.5px] leading-[1.65] text-[var(--fg)]">
                    {body}
                  </pre>
                </div>
              </section>

              {/* Contributing hits */}
              {contributing.length > 0 && (
                <section>
                  <h3 className="text-sm font-semibold text-[var(--fg)]">
                    Why it ranked
                  </h3>
                  <p className="mt-0.5 mb-3 text-[11px] leading-relaxed text-[var(--fg-subtle)]">
                    Retrieval units that contributed to this document’s score.
                    Top hit is highlighted.
                  </p>
                  <ul className="space-y-3">
                    {contributing.map((c, i) => {
                      const top = document.topChunkIds[0] === c.chunkId;
                      return (
                        <li
                          key={c.chunkId}
                          className={cn(
                            "rounded-xl border p-3.5",
                            top
                              ? "border-[var(--primary-border)] bg-[var(--primary-soft)] shadow-sm"
                              : "border-[var(--border)] bg-[var(--bg-elevated)]",
                          )}
                        >
                          <div className="mb-2 flex flex-wrap items-center gap-1.5">
                            {top && (
                              <span className="rounded-md bg-[var(--primary)] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                                Top hit
                              </span>
                            )}
                            <span className="rounded-md border border-[var(--border)] bg-[var(--bg-panel)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--fg-muted)]">
                              Hit {i + 1}
                            </span>
                            <span className="rounded-md border border-[var(--border)] bg-[var(--bg-panel)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--fg-muted)]">
                              Final #{c.finalRank}
                            </span>
                            <span className="rounded-md border border-[var(--border)] bg-[var(--bg-panel)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--fg-muted)]">
                              BM25 #{c.bm25Rank}
                            </span>
                            {c.denseRank != null && (
                              <span className="rounded-md border border-[var(--border)] bg-[var(--bg-panel)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--fg-muted)]">
                                Dense #{c.denseRank}
                              </span>
                            )}
                            <span className="rounded-md border border-[var(--border)] bg-[var(--bg-panel)] px-1.5 py-0.5 font-mono text-[10px] font-semibold text-[var(--fg)]">
                              {(c.finalScore ?? c.bm25Score).toFixed(3)}
                            </span>
                          </div>
                          <p className="text-[13px] leading-relaxed text-[var(--fg)]">
                            {c.text}
                          </p>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              )}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

function ScoreCard({
  label,
  value,
  accent,
  bar,
  hint,
}: {
  label: string;
  value: string;
  accent?: boolean;
  bar?: number;
  hint?: string;
}) {
  return (
    <div
      title={hint}
      className={cn(
        "rounded-xl border px-3 py-2",
        accent
          ? "border-[var(--primary-border)] bg-[var(--primary-soft)]"
          : "border-[var(--border)] bg-[var(--bg-panel)]",
      )}
    >
      <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--fg-subtle)]">
        {label}
      </div>
      <div
        className={cn(
          "mt-0.5 font-mono text-base font-bold tabular-nums",
          accent ? "text-[var(--primary)]" : "text-[var(--fg)]",
        )}
      >
        {value}
      </div>
      {bar != null && (
        <div
          className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/70 ring-1 ring-[var(--border)]"
          aria-hidden
        >
          <div
            className="h-full rounded-full bg-[var(--primary)]"
            style={{ width: `${bar}%` }}
          />
        </div>
      )}
    </div>
  );
}

function formatScore(value: number | null | undefined, digits: number) {
  return typeof value === "number" && Number.isFinite(value)
    ? value.toFixed(digits)
    : (0).toFixed(digits);
}
