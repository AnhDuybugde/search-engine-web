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
    <div className={cn("chat-composer-shell", className)}>
      <div className="mx-auto max-w-[var(--chat-max)] space-y-2">
        {showOpts && (
          <div className="flex flex-wrap items-center gap-4 rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2.5 text-xs text-[var(--fg-muted)] shadow-sm">
            <label className="inline-flex items-center gap-1.5">
              Results
              <input
                type="number"
                min={1}
                max={12}
                value={searchLimit}
                onChange={(e) => setSearchLimit(Number(e.target.value))}
                className="field w-14 min-h-8 !px-2 !py-1 text-center"
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
                className="field w-14 min-h-8 !px-2 !py-1 text-center"
              />
            </label>
            <label className="inline-flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={generateAnswer}
                onChange={(e) => setGenerateAnswer(e.target.checked)}
                className="h-3.5 w-3.5 accent-[var(--primary)]"
              />
              Generate answer
            </label>
          </div>
        )}

        <div className="chat-composer-box">
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
            className="max-h-36 min-h-[2.75rem] flex-1 resize-none bg-transparent py-2 text-[15px] text-[var(--fg)] outline-none placeholder:text-[var(--fg-subtle)]"
          />
          <div className="flex shrink-0 items-center gap-1 pb-0.5">
            <button
              type="button"
              className="btn-ghost !min-h-9 !rounded-lg !px-2"
              title="Options"
              onClick={() => setShowOpts((v) => !v)}
            >
              <Settings2 className="h-3.5 w-3.5" />
              <ChevronDown
                className={cn(
                  "h-3 w-3 transition-transform",
                  showOpts && "rotate-180",
                )}
              />
            </button>
            {running ? (
              <button
                type="button"
                onClick={onCancel}
                className="btn-ghost !min-h-9 !rounded-lg"
              >
                <Square className="h-3 w-3 fill-current" />
                Stop
              </button>
            ) : (
              <button
                type="button"
                onClick={submit}
                disabled={disabled || !query.trim()}
                className="btn-primary !min-h-9 !rounded-lg"
              >
                <CornerDownLeft className="h-3.5 w-3.5" />
                Send
              </button>
            )}
          </div>
        </div>
        <p className="text-center text-[11px] text-[var(--fg-subtle)]">
          <span className="kbd">Enter</span> send ·{" "}
          <span className="kbd">Shift</span>+
          <span className="kbd">Enter</span> newline
        </p>
      </div>
      {running && (
        <div className="mx-auto mt-2 flex max-w-[var(--chat-max)] items-center justify-center gap-2 text-xs font-medium text-[var(--primary)]">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Searching & answering…
        </div>
      )}
    </div>
  );
}
