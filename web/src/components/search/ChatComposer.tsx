"use client";

import { useState } from "react";
import {
  ChevronDown,
  CornerDownLeft,
  Loader2,
  Settings2,
  Square,
} from "lucide-react";
import { handleSubmitOnEnter } from "@/lib/keyboard";
import { cn } from "@/lib/utils";

export function ChatComposer({
  disabled,
  running,
  onSend,
  onCancel,
  className,
}: {
  disabled?: boolean;
  running?: boolean;
  onSend: (
    query: string,
    opts: {
      searchLimit: number;
      contextTopK: number;
      generateAnswer: boolean;
    },
  ) => void;
  onCancel?: () => void;
  className?: string;
}) {
  const [query, setQuery] = useState("");
  const [showOpts, setShowOpts] = useState(false);
  const [searchLimit, setSearchLimit] = useState(6);
  const [contextTopK, setContextTopK] = useState(4);
  const [generateAnswer, setGenerateAnswer] = useState(true);

  const submit = () => {
    const q = query.trim();
    if (!q || disabled || running) return;
    onSend(q, { searchLimit, contextTopK, generateAnswer });
    setQuery("");
  };

  return (
    <div
      className={cn(
        "border-t border-white/10 bg-[#070b14]/80 px-3 py-3 backdrop-blur-xl sm:px-6",
        className,
      )}
    >
      <div className="mx-auto max-w-3xl space-y-2">
        {showOpts && (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-[var(--fg-muted)]">
            <label className="inline-flex items-center gap-1.5">
              Results
              <input
                type="number"
                min={1}
                max={12}
                value={searchLimit}
                onChange={(e) => setSearchLimit(Number(e.target.value))}
                className="field w-14 min-h-8 px-2 py-1 text-center"
              />
            </label>
            <label className="inline-flex items-center gap-1.5">
              Context
              <input
                type="number"
                min={1}
                max={5}
                value={contextTopK}
                onChange={(e) => setContextTopK(Number(e.target.value))}
                className="field w-14 min-h-8 px-2 py-1 text-center"
              />
            </label>
            <label className="inline-flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={generateAnswer}
                onChange={(e) => setGenerateAnswer(e.target.checked)}
                className="h-4 w-4 accent-indigo-500"
              />
              Generate answer
            </label>
          </div>
        )}

        <div className="relative">
          <textarea
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) =>
              handleSubmitOnEnter(e, () => submit(), {
                allowShiftNewline: true,
              })
            }
            rows={2}
            placeholder="Ask a follow-up or start a new research question…"
            disabled={disabled || running}
            className="field min-h-[72px] resize-none py-3 pr-28 text-base shadow-[0_0_0_1px_rgba(129,140,248,0.12)]"
          />
          <div className="absolute bottom-2.5 right-2.5 flex items-center gap-1.5">
            <button
              type="button"
              className="btn-ghost !min-h-9 !px-2"
              title="Options"
              onClick={() => setShowOpts((v) => !v)}
            >
              <Settings2 className="h-4 w-4" />
              <ChevronDown
                className={cn(
                  "h-3 w-3 transition",
                  showOpts && "rotate-180",
                )}
              />
            </button>
            {running ? (
              <button
                type="button"
                onClick={onCancel}
                className="btn-ghost !min-h-9"
              >
                <Square className="h-3.5 w-3.5 fill-current" />
                Stop
              </button>
            ) : (
              <button
                type="button"
                onClick={submit}
                disabled={disabled || !query.trim()}
                className="btn-primary !min-h-9"
              >
                <CornerDownLeft className="h-4 w-4" />
                Send
              </button>
            )}
          </div>
        </div>
        <p className="text-center text-[11px] text-[var(--fg-muted)]">
          <span className="kbd">Enter</span> send ·{" "}
          <span className="kbd">Shift</span>+
          <span className="kbd">Enter</span> newline · context stays in this
          chat
        </p>
      </div>
      {running && (
        <div className="mx-auto mt-2 flex max-w-3xl items-center justify-center gap-2 text-xs text-indigo-200/80">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Searching & answering…
        </div>
      )}
    </div>
  );
}
