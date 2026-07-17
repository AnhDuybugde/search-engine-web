import { Check, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";

const labels: Record<string, string> = {
  expand: "Context",
  search: "Search",
  fetch: "Fetch",
  chunk: "Chunk",
  retrieve: "Retrieve",
  generate: "Generate",
};

export function StepRail({
  steps,
}: {
  steps: Record<string, "pending" | "running" | "success" | "failed">;
}) {
  return (
    <div className="flex flex-wrap gap-2" role="list" aria-label="Pipeline steps">
      {Object.entries(labels).map(([key, label]) => {
        const status = steps[key] || "pending";
        return (
          <div
            key={key}
            role="listitem"
            className={cn(
              "inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition",
              status === "success" &&
                "border-emerald-400/35 bg-emerald-500/10 text-emerald-300",
              status === "running" &&
                "border-indigo-400/40 bg-indigo-500/15 text-indigo-200",
              status === "failed" &&
                "border-rose-400/40 bg-rose-500/10 text-rose-300",
              status === "pending" &&
                "border-white/10 bg-white/[0.03] text-[var(--fg-muted)]",
            )}
          >
            {status === "running" && (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            )}
            {status === "success" && <Check className="h-3.5 w-3.5" aria-hidden />}
            {status === "failed" && <X className="h-3.5 w-3.5" aria-hidden />}
            {label}
          </div>
        );
      })}
    </div>
  );
}
