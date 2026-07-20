"use client";

import { useState } from "react";
import {
  CornerDownLeft,
  Loader2,
  Paperclip,
  Square,
} from "lucide-react";
import { handleSubmitOnEnter } from "@/lib/keyboard";
import { cn } from "@/lib/utils";

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
  onSend: (query: string) => void;
  onCancel?: () => void;
  onUpload?: (file: File) => void;
  placeholder?: string;
  className?: string;
}) {
  const [query, setQuery] = useState("");

  const submit = () => {
    const q = query.trim();
    if (!q || disabled || running) return;
    onSend(q);
    setQuery("");
  };

  return (
    <div className={cn("chat-composer-shell", className)}>
      <div className="mx-auto max-w-[var(--chat-max)] space-y-2">
        <div className="chat-composer-box !pl-1.5">
          {onUpload && (
            <label className="inline-flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-xl text-[var(--fg-muted)] transition hover:bg-[var(--surface-hover)] hover:text-[var(--primary)]">
              {uploading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Paperclip className="h-4 w-4" aria-hidden />
              )}
              <span className="sr-only">Upload document</span>
              <input
                type="file"
                accept=".pdf,.txt,.md,.markdown,.csv,.json,text/plain,application/pdf"
                className="hidden"
                disabled={uploading || running}
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
            className="max-h-36 min-h-[2.75rem] flex-1 resize-none bg-transparent py-2 text-[15px] text-[var(--fg)] outline-none placeholder:text-[var(--fg-subtle)]"
            disabled={disabled || running}
          />
          <div className="flex shrink-0 items-center gap-1 pb-0.5">
            {running ? (
              <button
                type="button"
                onClick={onCancel}
                className="btn-ghost !min-h-9 !rounded-lg"
              >
                <Square className="h-3.5 w-3.5" />
                Stop
              </button>
            ) : (
              <button
                type="button"
                onClick={submit}
                disabled={disabled || !query.trim()}
                className="btn-primary !min-h-9 !rounded-lg"
              >
                <CornerDownLeft className="h-4 w-4" />
                Send
              </button>
            )}
          </div>
        </div>
        <p className="text-center text-[11px] text-[var(--fg-subtle)]">
          Paperclip stores raw sources · search ranks full text at query time ·
          process lab
        </p>
      </div>
    </div>
  );
}
