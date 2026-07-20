"use client";

import { useEffect, useState } from "react";
import { Loader2, X } from "lucide-react";
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

export function DocumentDetailDrawer({
  notebookId,
  document,
  rankedChunks,
  open,
  onClose,
}: {
  notebookId: string;
  document: RankedDocument | null;
  rankedChunks: RankedChunk[];
  open: boolean;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<SourceDetail | null>(null);

  useEffect(() => {
    if (!open || !document) {
      setSource(null);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setSource(null);

    void (async () => {
      try {
        const res = await fetch(
          `/api/notebooks/${notebookId}/sources/${document.documentId}`,
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

  if (!open || !document) return null;

  const contributing = rankedChunks.filter(
    (c) =>
      c.documentId === document.documentId ||
      document.topChunkIds.includes(c.chunkId),
  );

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal>
      <button
        type="button"
        className="absolute inset-0 bg-slate-900/30 backdrop-blur-[1px]"
        aria-label="Close document detail"
        onClick={onClose}
      />
      <aside className="relative flex h-full w-full max-w-xl flex-col border-l border-[var(--border)] bg-[var(--bg-elevated)] shadow-[var(--shadow-md)]">
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--fg-subtle)]">
              Document #{document.finalRank}
            </p>
            <h2 className="mt-0.5 text-base font-semibold leading-snug text-[var(--fg)]">
              {document.title}
            </h2>
            <div className="mt-2 flex flex-wrap gap-2 font-mono text-[10px] text-[var(--fg-muted)]">
              <span className="rounded border border-[var(--border)] px-1.5 py-0.5">
                score {document.finalScore.toFixed(3)}
              </span>
              <span className="rounded border border-[var(--primary-border)] bg-[var(--primary-soft)] px-1.5 py-0.5 text-[var(--primary)]">
                conf {(document.confidence * 100).toFixed(0)}%
              </span>
              {document.bm25Best != null && (
                <span className="rounded border border-[var(--border)] px-1.5 py-0.5">
                  BM25 {document.bm25Best.toFixed(3)}
                </span>
              )}
              {document.denseBest != null && (
                <span className="rounded border border-[var(--border)] px-1.5 py-0.5">
                  Dense {document.denseBest.toFixed(3)}
                </span>
              )}
              <span className="rounded border border-[var(--border)] px-1.5 py-0.5">
                {document.chunkHits} retrieval hit
                {document.chunkHits === 1 ? "" : "s"}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="btn-ghost !min-h-8 !px-2"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {loading && (
            <div className="flex items-center gap-2 text-sm text-[var(--fg-muted)]">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading document…
            </div>
          )}
          {error && (
            <p role="alert" className="text-sm text-[var(--danger)]">
              {error}
            </p>
          )}

          {source && (
            <section className="space-y-4">
              <div>
                <h3 className="section-title">Full content</h3>
                <div className="max-h-[40vh] overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--bg-panel)] p-3 text-sm leading-relaxed whitespace-pre-wrap text-[var(--fg)]">
                  {source.text}
                </div>
                <p className="mt-1 text-[11px] text-[var(--fg-subtle)]">
                  {source.charCount.toLocaleString()} chars ·{" "}
                  {source.chunks.length === 0
                    ? "raw source (no stored chunks)"
                    : `${source.chunks.length} stored chunk row${source.chunks.length === 1 ? "" : "s"}`}
                </p>
              </div>

              {contributing.length > 0 && (
                <div>
                  <h3 className="section-title">Contributing retrieval hits</h3>
                  <ul className="space-y-2">
                    {contributing.map((c) => (
                      <li
                        key={c.chunkId}
                        className={cn(
                          "rounded-lg border border-[var(--border)] p-3 text-xs",
                          document.topChunkIds[0] === c.chunkId &&
                            "border-[var(--primary-border)] bg-[var(--primary-soft)]",
                        )}
                      >
                        <div className="mb-1 flex flex-wrap gap-1.5 font-mono text-[10px] text-[var(--fg-muted)]">
                          <span>final #{c.finalRank}</span>
                          <span>BM25 #{c.bm25Rank}</span>
                          {c.denseRank != null && <span>Dense #{c.denseRank}</span>}
                          <span>
                            score{" "}
                            {(c.finalScore ?? c.bm25Score).toFixed(3)}
                          </span>
                        </div>
                        <p className="leading-relaxed text-[var(--fg-muted)]">
                          {c.text}
                        </p>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
          )}
        </div>
      </aside>
    </div>
  );
}
