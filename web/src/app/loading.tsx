import { Loader2 } from "lucide-react";

export default function Loading() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-[var(--bg-base)] text-sm text-[var(--fg-muted)]">
      <div className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--bg-elevated)] px-4 py-2.5 shadow-sm" role="status" aria-live="polite">
        <Loader2 className="h-4 w-4 animate-spin text-[var(--mood)]" aria-hidden />
        Loading workspace…
      </div>
    </div>
  );
}
