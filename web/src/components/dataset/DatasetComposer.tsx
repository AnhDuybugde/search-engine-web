"use client";

import { useEffect, useState } from "react";
import {
  CornerDownLeft,
  Loader2,
  Paperclip,
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

const ACCEPT =
  ".pdf,.txt,.md,.markdown,.csv,.json,text/plain,text/csv,application/pdf,application/csv";

export function DatasetComposer({
  disabled,
  running,
  onSend,
  onCancel,
  onUpload,
  uploading,
  placeholder,
  className,
}: {
  disabled?: boolean;
  running?: boolean;
  uploading?: boolean;
  onSend: (query: string, opts: { retrievalMode: RetrievalModeId }) => void;
  onCancel?: () => void;
  /** Add one document to the open dataset (not used for New dataset create). */
  onUpload?: (file: File) => void;
  placeholder?: string;
  className?: string;
}) {
  const [query, setQuery] = useState("");
  const [retrievalMode, setRetrievalMode] = useState<RetrievalModeId>(
    "adaptive_rrf",
  );

  useEffect(() => {
    setRetrievalMode(readStoredRetrievalMode());
  }, []);

  const setMode = (mode: RetrievalModeId) => {
    setRetrievalMode(mode);
    storeRetrievalMode(mode);
  };

  const submit = () => {
    const q = query.trim();
    if (!q || disabled || running) return;
    onSend(q, { retrievalMode });
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
        <div className="chat-composer-box !pl-1.5">
          {onUpload && (
            <label
              className={cn(
                "inline-flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-xl text-[var(--fg-muted)] transition hover:bg-[var(--accent-soft)] hover:text-[var(--accent)]",
                (uploading || running) && "pointer-events-none opacity-50",
              )}
              title="Add one document to this open dataset"
            >
              {uploading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Paperclip className="h-4 w-4" aria-hidden />
              )}
              <span className="sr-only">Add document to this dataset</span>
              <input
                type="file"
                accept={ACCEPT}
                className="hidden"
                disabled={uploading || running}
                // one file per pick — no multiple
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onUpload(f);
                  e.target.value = "";
                }}
              />
            </label>
          )}
          <textarea
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) =>
              handleSubmitOnEnter(e, submit, { allowShiftNewline: true })
            }
            rows={2}
            placeholder={
              placeholder ||
              "Ask about your documents… (Enter send · Shift+Enter newline)"
            }
            aria-label="Message"
            className="max-h-36 min-h-[2.75rem] flex-1 resize-none bg-transparent py-2 text-[15px] text-[var(--fg)] outline-none placeholder:text-[var(--fg-subtle)]"
            disabled={disabled || running}
          />
          <div className="flex shrink-0 items-center gap-1 pb-0.5">
            {running ? (
              <button
                type="button"
                onClick={onCancel}
                className="btn-secondary !min-h-10 !rounded-xl"
              >
                <Square className="h-3.5 w-3.5" />
                Stop
              </button>
            ) : (
              <button
                type="button"
                onClick={submit}
                disabled={disabled || !query.trim()}
                className="btn-primary !min-h-10 !rounded-xl"
              >
                <CornerDownLeft className="h-4 w-4" />
                Send
              </button>
            )}
          </div>
        </div>
        <p className="text-center text-[11px] text-[var(--fg-subtle)]">
          {onUpload
            ? "Paperclip adds one file to this open dataset · ranking at query time"
            : "Open a dataset to chat · New dataset uses one starter file"}
        </p>
      </div>
    </div>
  );
}
