import { Check, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";

const labels: Record<string, string> = {
  expand: "Context",
  corpus: "Sources",
  search: "Search",
  fetch: "Fetch",
  chunk: "Units",
  query: "Query",
  retrieve: "Retrieve",
  embedding: "Embed",
  fusion: "Fusion",
  pack: "Pack",
  generate: "Generate",
};

export function StepRail({
  steps,
  className,
}: {
  steps: Record<string, "pending" | "running" | "success" | "failed">;
  className?: string;
}) {
  const keys = Object.keys(labels).filter((key) => key in steps);
  if (!keys.length) return null;

  return (
    <div
      className={cn(
        "chat-step-rail",
        className,
      )}
      role="list"
      aria-label="Pipeline steps"
    >
      {keys.map((key, i) => {
        const label = labels[key] || key;
        const status = steps[key] || "pending";
        const isLast = i === keys.length - 1;
        return (
          <div key={key} className="flex min-w-0 items-center" role="listitem">
            <div
              className={cn(
                "chat-step-pill",
                status === "success" && "chat-step-pill--success",
                status === "running" && "chat-step-pill--running",
                status === "failed" && "chat-step-pill--failed",
                status === "pending" && "chat-step-pill--pending",
              )}
            >
              <span className="chat-step-icon" aria-hidden>
                {status === "running" && (
                  <Loader2 className="h-3 w-3 animate-spin" />
                )}
                {status === "success" && <Check className="h-3 w-3" strokeWidth={2.5} />}
                {status === "failed" && <X className="h-3 w-3" strokeWidth={2.5} />}
                {status === "pending" && (
                  <span className="h-1.5 w-1.5 rounded-full bg-current opacity-50" />
                )}
              </span>
              <span className="truncate">{label}</span>
            </div>
            {!isLast && (
              <span
                className={cn(
                  "chat-step-connector",
                  (status === "success" || status === "running") &&
                    "chat-step-connector--active",
                )}
                aria-hidden
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
