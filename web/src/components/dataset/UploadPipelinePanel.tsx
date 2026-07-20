"use client";

import { Check, Loader2, X } from "lucide-react";
import type { UploadSseState } from "@/lib/hooks/use-upload-sse";
import { cn } from "@/lib/utils";

/** Raw-only store stages — no chunk/embed index at ingest. */
const STEP_META: { id: string; label: string; hint: string }[] = [
  { id: "receive", label: "Receive file", hint: "Upload received by server" },
  { id: "extract", label: "Extract text", hint: "PDF/plain text extraction" },
  {
    id: "store",
    label: "Store raw source",
    hint: "Persist full document text only (no chunks, no embeddings)",
  },
];

function fmtMs(ms?: number) {
  if (ms == null || !Number.isFinite(ms)) return null;
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

export function UploadPipelinePanel({ state }: { state: UploadSseState }) {
  if (state.status === "idle" && !state.result) {
    return (
      <p className="text-xs leading-relaxed text-[var(--fg-subtle)]">
        Upload tracks <strong className="font-medium text-[var(--fg-muted)]">receive → extract → store</strong>{" "}
        raw text only. Chunking and embedding are not run at ingest time.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--fg-subtle)]">
          Store pipeline
        </h3>
        {state.timing?.totalMs != null && (
          <span className="font-mono text-[10px] text-[var(--fg-muted)]">
            {fmtMs(state.timing.totalMs)} total
          </span>
        )}
      </div>

      {state.filename && (
        <p className="truncate text-xs font-medium text-[var(--fg)]">
          {state.filename}
        </p>
      )}

      <ol className="space-y-1">
        {STEP_META.map((step) => {
          const status = state.steps[step.id] || "pending";
          const ms = state.stepMs[step.id];
          return (
            <li
              key={step.id}
              className={cn(
                "flex items-start gap-2 rounded-md border px-2.5 py-2",
                status === "running" &&
                  "border-[var(--primary-border)] bg-[var(--primary-soft)]",
                status === "success" && "border-[var(--border)] bg-[var(--surface)]",
                status === "failed" && "border-rose-500/30 bg-rose-50",
                status === "pending" && "border-transparent bg-transparent",
              )}
            >
              <StatusDot status={status} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[12px] font-medium text-[var(--fg)]">
                    {step.label}
                  </span>
                  {ms != null && (
                    <span className="font-mono text-[10px] text-[var(--fg-muted)]">
                      {fmtMs(ms)}
                    </span>
                  )}
                </div>
                <p className="text-[10px] text-[var(--fg-subtle)]">{step.hint}</p>
              </div>
            </li>
          );
        })}
      </ol>

      {state.result && (
        <p className="rounded-md border border-[var(--border)] bg-[var(--bg-panel)] px-2.5 py-2 text-[11px] text-[var(--fg-muted)]">
          Stored raw source{" "}
          <strong className="text-[var(--fg)]">{state.result.title}</strong>
          {" · "}
          {state.result.charCount.toLocaleString()} chars · no chunk/embed index
        </p>
      )}

      {state.error && (
        <p role="alert" className="text-xs text-[var(--danger)]">
          {state.error}
        </p>
      )}
    </div>
  );
}

function StatusDot({
  status,
}: {
  status: "pending" | "running" | "success" | "failed";
}) {
  if (status === "running") {
    return <Loader2 className="mt-0.5 h-3.5 w-3.5 animate-spin text-[var(--primary)]" />;
  }
  if (status === "success") {
    return (
      <span className="mt-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-emerald-50 text-emerald-700 ring-1 ring-emerald-600/25">
        <Check className="h-2.5 w-2.5" />
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span className="mt-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-rose-50 text-rose-600 ring-1 ring-rose-500/30">
        <X className="h-2.5 w-2.5" />
      </span>
    );
  }
  return (
    <span className="mt-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full border border-[var(--border)]">
      <span className="h-1 w-1 rounded-full bg-[var(--fg-subtle)]" />
    </span>
  );
}
