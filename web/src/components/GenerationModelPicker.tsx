"use client";

import { useEffect, useState } from "react";

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

  if (!models.length) return null;

  return (
    <label className="inline-flex min-h-8 items-center gap-1.5 rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] px-2.5 text-[11px] font-medium text-[var(--fg-muted)]">
      <span className="text-[var(--fg-subtle)]">Answer</span>
      <select
        value={value || models[0]}
        disabled={disabled}
        aria-label="Answer generation model"
        onChange={(event) => onChange(event.target.value)}
        className="max-w-[13rem] truncate bg-transparent text-[var(--fg)] outline-none"
      >
        {models.map((model) => (
          <option key={model} value={model}>{model}</option>
        ))}
      </select>
    </label>
  );
}
