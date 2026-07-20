"use client";

import { Loader2 } from "lucide-react";

export function LoadingOverlay({
  show,
  label = "Working…",
}: {
  show: boolean;
  label?: string;
}) {
  if (!show) return null;
  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-4 z-50 flex justify-center px-4 sm:left-[var(--rail-w)]"
      role="status"
      aria-live="polite"
    >
      <div className="anim-enter inline-flex items-center gap-2 rounded-full border border-[var(--mood-border)] bg-[var(--bg-elevated)]/95 px-3.5 py-2 text-sm text-[var(--fg)] shadow-[var(--shadow-md)] backdrop-blur-md">
        <Loader2
          className="h-3.5 w-3.5 animate-spin text-[var(--mood)]"
          aria-hidden
        />
        <span className="text-[13px] font-medium">{label}</span>
      </div>
    </div>
  );
}

export function ButtonSpinner({ label }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      {label || "Loading…"}
    </span>
  );
}
