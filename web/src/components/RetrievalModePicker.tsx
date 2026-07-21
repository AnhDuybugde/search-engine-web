"use client";

import { cn } from "@/lib/utils";
import {
  RETRIEVAL_MODES,
  type RetrievalModeId,
} from "@/lib/ir/retrieval-modes";

/**
 * Segmented control for switching retrieval methods at query time.
 * Modes come from RETRIEVAL_MODES — add entries there to extend the UI.
 */
export function RetrievalModePicker({
  value,
  onChange,
  disabled,
  className,
  size = "md",
}: {
  value: RetrievalModeId;
  onChange: (mode: RetrievalModeId) => void;
  disabled?: boolean;
  className?: string;
  size?: "sm" | "md";
}) {
  return (
    <div
      className={cn(
        "inline-flex items-center rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-0.5 shadow-sm",
        disabled && "opacity-60",
        className,
      )}
      role="radiogroup"
      aria-label="Retrieval method"
    >
      {RETRIEVAL_MODES.map((mode) => {
        const active = value === mode.id;
        return (
          <button
            key={mode.id}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            title={mode.description}
            onClick={() => onChange(mode.id)}
            className={cn(
              "rounded-[10px] font-medium transition-colors",
              size === "sm"
                ? "px-2.5 py-1 text-[11px]"
                : "px-3 py-1.5 text-xs",
              active
                ? "bg-[var(--accent)] text-white shadow-sm"
                : "text-[var(--fg-muted)] hover:bg-[var(--accent-soft)] hover:text-[var(--accent)]",
            )}
          >
            {mode.shortLabel}
          </button>
        );
      })}
    </div>
  );
}
