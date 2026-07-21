"use client";

import { Check, ChevronDown } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import {
  RETRIEVAL_MODES,
  type RetrievalModeId,
} from "@/lib/ir/retrieval-modes";

/** Compact ChatGPT-style model/retrieval menu shared by both composers. */
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
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const pickerId = useId().replace(/:/g, "");
  const optionsId = `retrieval-model-options-${pickerId}`;
  const selected = RETRIEVAL_MODES.find((mode) => mode.id === value) || RETRIEVAL_MODES[0];

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  return (
    <div ref={rootRef} className={cn("relative inline-flex", className)}>
      <button
        type="button"
        disabled={disabled}
        role="combobox"
        aria-label="Retrieval model"
        aria-expanded={open}
        aria-controls={optionsId}
        aria-haspopup="listbox"
        onClick={() => setOpen((current) => !current)}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] font-medium text-[var(--fg-muted)] shadow-sm transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/30",
          disabled && "cursor-not-allowed opacity-60",
          size === "sm" ? "min-h-8 px-2.5 text-[11px]" : "min-h-9 px-3 text-xs",
        )}
      >
        <span className="max-w-[10rem] truncate">{selected.shortLabel}</span>
        <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />
      </button>

      {open && !disabled ? (
        <div
          role="listbox"
          id={optionsId}
          aria-label="Retrieval models"
          className="absolute bottom-[calc(100%+0.5rem)] right-0 z-50 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--bg-elevated)] p-1.5 shadow-[0_18px_50px_rgba(31,24,88,0.18)]"
        >
          <div className="px-2.5 pb-1.5 pt-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--fg-subtle)]">
            Retrieval model
          </div>
          {RETRIEVAL_MODES.map((mode) => {
            const active = value === mode.id;
            return (
              <button
                key={mode.id}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => {
                  onChange(mode.id);
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-start gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-[var(--accent-soft)]",
                  active && "bg-[var(--accent-soft)]",
                )}
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-semibold text-[var(--fg)]">{mode.label}</span>
                  <span className="mt-0.5 block text-[11px] leading-4 text-[var(--fg-muted)]">
                    {mode.description}
                  </span>
                </span>
                {active ? <Check className="mt-0.5 size-4 shrink-0 text-[var(--accent)]" /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
