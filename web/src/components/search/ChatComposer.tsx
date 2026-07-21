"use client";

import { useState } from "react";
import {
  ChevronDown,
  CornerDownLeft,
  Loader2,
  Settings2,
  Square,
} from "lucide-react";
import { RetrievalModePicker } from "@/components/RetrievalModePicker";
import { handleSubmitOnEnter } from "@/lib/keyboard";
import {
  readStoredRetrievalMode,
  storeRetrievalMode,
  type RetrievalModeId,
} from "@/lib/ir/retrieval-modes";
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
      retrievalMode: RetrievalModeId;
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
  const [retrievalMode, setRetrievalMode] = useState<RetrievalModeId>(
    () => readStoredRetrievalMode(),
  );

  const setMode = (mode: RetrievalModeId) => {
    setRetrievalMode(mode);
    storeRetrievalMode(mode);
  };

  const submit = () => {
    const q = query.trim();
    if (!q || disabled || running) return;
    onSend(q, { searchLimit, contextTopK, generateAnswer, retrievalMode });
    setQuery("");
  };

  return (
    <div className={cn("chat-composer-shell", className)}>
      <div className="mx-auto max-w-[var(--chat-max)] space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2 px-0.5">
          <span className="text-[11px] font-medium text-[var(--fg-subtle)]">
            Retrieval method
          </span>
          <RetrievalModePicker
            value={retrievalMode}
            onChange={setMode}
            disabled={disabled || running}
            size="sm"
          />
        </div>

        {showOpts && (
          <div
            className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] px-3.5 py-3 text-xs text-[var(--fg-muted)] shadow-sm"
            role="group"
            aria-label="Search options"
          >
            <label className="inline-flex items-center gap-2 font-medium">
              Results
              <input
                type="number"
                min={1}
                max={12}
                value={searchLimit}
                onChange={(e) => setSearchLimit(Number(e.target.value))}
                className="field w-14 min-h-9 !px-2 !py-1 text-center"
                aria-label="Number of search results"
              />
            </label>
            <label className="inline-flex items-center gap-2 font-medium">
              Context
              <input
                type="number"
                min={1}
                max={5}
                value={contextTopK}
                onChange={(e) => setContextTopK(Number(e.target.value))}
                className="field w-14 min-h-9 !px-2 !py-1 text-center"
                aria-label="Context top-k for generation"
              />
            </label>
            <label className="inline-flex cursor-pointer items-center gap-2 font-medium">
              <input
                type="checkbox"
                checked={generateAnswer}
                onChange={(e) => setGenerateAnswer(e.target.checked)}
                className="h-4 w-4 accent-[var(--accent)]"
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
            placeholder="Ask a research question or follow up…"
            disabled={disabled || running}
            aria-label="Message"
            className="max-h-36 min-h-[2.75rem] flex-1 resize-none bg-transparent py-2 text-[15px] text-[var(--fg)] outline-none placeholder:text-[var(--fg-subtle)]"
          />
          <div className="flex shrink-0 items-center gap-1 pb-0.5">
            <button
              type="button"
              className={cn(
                "btn-ghost !min-h-10 !rounded-xl !px-2.5",
                showOpts && "bg-[var(--accent-soft)] text-[var(--accent)]",
              )}
              title="Options"
              aria-expanded={showOpts}
              aria-label="Toggle search options"
              onClick={() => setShowOpts((v) => !v)}
            >
              <Settings2 className="h-4 w-4" />
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
                className="btn-secondary !min-h-10 !rounded-xl"
              >
                <Square className="h-3 w-3 fill-current" />
                Stop
              </button>
            ) : (
              <button
                type="button"
                onClick={submit}
                disabled={disabled || !query.trim()}
                className="btn-primary !min-h-10 !rounded-xl"
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
        <div className="mx-auto mt-2 flex max-w-[var(--chat-max)] items-center justify-center gap-2 text-xs font-medium text-[var(--accent)]">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Searching & answering…
        </div>
      )}
    </div>
  );
}
