"use client";

import { Check, Loader2, X } from "lucide-react";
import type { UploadSseState } from "@/lib/hooks/use-upload-sse";
import { cn } from "@/lib/utils";

const STEP_META: { id: string; label: string; hint: string }[] = [
  { id: "receive", label: "Receive file", hint: "Upload received by server" },
  { id: "extract", label: "Extract text", hint: "PDF / plain text extraction" },
  {
    id: "store",
    label: "Store source",
    hint: "Full text saved to Supabase Postgres (sources)",
  },
  {
    id: "embed",
    label: "Embed units",
    hint: "Dense vectors via embedding API (batched)",
  },
  {
    id: "persist",
    label: "Persist index",
    hint: "Write chunks + embedding_json to Postgres",
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
        Upload runs{" "}
        <strong className="font-medium text-[var(--fg-muted)]">
          receive → extract → store → embed → persist
        </strong>
        . Vectors are stored in{" "}
        <strong className="font-medium text-[var(--fg-muted)]">
          Supabase Postgres
        </strong>{" "}
        (<code className="text-[10px]">chunks.embedding_json</code>), not MongoDB.
        Success / fail shows on each step.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--fg-subtle)]">
          Ingest pipeline
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
                {step.id === "embed" && state.indexPercent != null && (
                  <div className="mt-1.5">
                    <div className="h-1.5 overflow-hidden rounded-full bg-[var(--bg-panel)] ring-1 ring-[var(--border)]">
                      <span
                        className="block h-full rounded-full bg-[var(--accent)] transition-[width]"
                        style={{ width: `${state.indexPercent}%` }}
                      />
                    </div>
                    <p className="mt-1 font-mono text-[10px] text-[var(--fg-muted)]">
                      {state.indexPercent}%
                      {state.indexMessage ? ` · ${state.indexMessage}` : ""}
                    </p>
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      {state.result && (
        <p
          className={cn(
            "rounded-md border px-2.5 py-2 text-[11px]",
            state.status === "failed"
              ? "border-rose-500/30 bg-rose-50 text-rose-800"
              : "border-[var(--border)] bg-[var(--bg-panel)] text-[var(--fg-muted)]",
          )}
        >
          <strong className="text-[var(--fg)]">{state.result.title}</strong>
          {" · "}
          {state.result.charCount.toLocaleString()} chars
          {" · "}
          {(state.metrics?.embeddedCount ?? 0).toLocaleString()} vectors
          {" · "}
          {state.metrics?.storage || "supabase-postgres"}
          {state.metrics?.mode ? ` · ${state.metrics.mode}` : ""}
        </p>
      )}

      {state.error && (
        <p role="alert" className="text-xs text-[var(--danger)]">
          {state.error}
        </p>
      )}

      {state.logs.length > 0 && (
        <details className="rounded-md border border-[var(--border)] bg-[var(--surface)]">
          <summary className="cursor-pointer px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--fg-subtle)]">
            Log ({state.logs.length})
          </summary>
          <ul className="max-h-32 space-y-0.5 overflow-y-auto border-t border-[var(--border)] px-2.5 py-2 font-mono text-[10px] text-[var(--fg-muted)]">
            {state.logs.map((line, i) => (
              <li key={`${i}-${line.slice(0, 24)}`}>{line}</li>
            ))}
          </ul>
        </details>
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
