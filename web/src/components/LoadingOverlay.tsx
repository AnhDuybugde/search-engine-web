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
      className="pointer-events-none fixed inset-x-0 top-[4.5rem] z-50 flex justify-center px-4"
      role="status"
      aria-live="polite"
    >
      <div className="inline-flex items-center gap-2 rounded-full border border-indigo-300/30 bg-[#0b1020]/90 px-4 py-2 text-sm text-indigo-100 shadow-[0_8px_30px_rgba(0,0,0,0.35)] backdrop-blur-xl">
        <Loader2 className="h-4 w-4 animate-spin text-teal-300" aria-hidden />
        <span>{label}</span>
        <span className="ml-1 flex gap-1">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-teal-300/90" />
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-indigo-300/90 [animation-delay:150ms]" />
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-violet-300/90 [animation-delay:300ms]" />
        </span>
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
