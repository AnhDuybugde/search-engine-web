"use client";

import { Check, ChevronDown } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export function GenerationModelPicker({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (model: string) => void;
  disabled?: boolean;
}) {
  const [models, setModels] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const pickerId = useId().replace(/:/g, "");
  const optionsId = `generation-model-options-${pickerId}`;

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/llm/models", { signal: controller.signal, cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { models?: unknown; defaultModel?: unknown } | null) => {
        if (!data) return;
        const available = Array.isArray(data.models)
          ? data.models.filter((model): model is string => typeof model === "string")
          : [];
        setModels(available);
        if (!value && typeof data.defaultModel === "string") onChange(data.defaultModel);
      })
      .catch(() => {
        if (!controller.signal.aborted) setModels([]);
      });
    return () => controller.abort();
  }, [onChange, value]);

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

  if (!models.length) return null;

  const selected = value || models[0];

  return (
    <div ref={rootRef} className="relative inline-flex">
      <button
        type="button"
        disabled={disabled}
        role="combobox"
        aria-label="Answer generation model"
        aria-expanded={open}
        aria-controls={optionsId}
        aria-haspopup="listbox"
        onClick={() => setOpen((current) => !current)}
        className={cn(
          "inline-flex min-h-8 items-center gap-1.5 rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] px-2.5 text-[11px] font-medium text-[var(--fg-muted)] shadow-sm transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/30",
          disabled && "cursor-not-allowed opacity-60",
        )}
      >
        <span className="text-[var(--fg-subtle)]">Answer</span>
        <span className="max-w-[11rem] truncate text-[var(--fg)]">{selected}</span>
        <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />
      </button>

      {open && !disabled ? (
        <div
          role="listbox"
          id={optionsId}
          aria-label="Answer generation models"
          className="absolute bottom-[calc(100%+0.5rem)] right-0 z-50 w-[min(24rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--bg-elevated)] p-1.5 shadow-[0_18px_50px_rgba(31,24,88,0.18)]"
        >
          <div className="px-2.5 pb-1.5 pt-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--fg-subtle)]">
            Answer model
          </div>
          {models.map((model) => {
            const active = selected === model;
            return (
              <button
                key={model}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => {
                  onChange(model);
                  setOpen(false);
                }}
                className={cn(
                  "flex min-h-10 w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-[var(--accent-soft)]",
                  active && "bg-[var(--accent-soft)]",
                )}
              >
                <span className="min-w-0 flex-1 truncate text-xs font-semibold text-[var(--fg)]">
                  {model}
                </span>
                {active ? <Check className="size-4 shrink-0 text-[var(--accent)]" /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
