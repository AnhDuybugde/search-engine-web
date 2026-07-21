"use client";

import { useEffect, useId, useRef, useState } from "react";
import { FileUp, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";

const ACCEPT =
  ".pdf,.txt,.md,.markdown,.csv,.json,text/plain,text/csv,application/pdf,application/csv";

function titleFromFile(file: File): string {
  const base = file.name.replace(/\.[^.]+$/, "").trim();
  return base || file.name || "Untitled dataset";
}

/**
 * Create a dataset with exactly one starter document.
 * Extra documents are added later from the open notebook (Sources → Add document).
 */
export function NewDatasetDialog({
  open,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  open: boolean;
  busy?: boolean;
  error?: string | null;
  onClose: () => void;
  onSubmit: (payload: { title: string; file: File }) => void | Promise<void>;
}) {
  const titleId = useId();
  const fileId = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  // Reset the native file input and local draft whenever the dialog opens.
  /* eslint-disable react-hooks/set-state-in-effect -- dialog-open reset is intentional. */
  useEffect(() => {
    if (!open) return;
    setTitle("");
    setFile(null);
    setLocalError(null);
    if (fileRef.current) fileRef.current.value = "";
  }, [open]);
  /* eslint-enable react-hooks/set-state-in-effect */

  if (!open) return null;

  const pickFile = (f: File | null | undefined) => {
    if (!f) return;
    setFile(f);
    setLocalError(null);
    setTitle((prev) => (prev.trim() ? prev : titleFromFile(f)));
  };

  const submit = () => {
    if (busy) return;
    if (!file) {
      setLocalError("Choose exactly one document to start this dataset.");
      return;
    }
    const name = title.trim() || titleFromFile(file);
    void onSubmit({ title: name, file });
  };

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <button
        type="button"
        className="absolute inset-0 bg-slate-900/40"
        aria-label="Close dialog"
        disabled={busy}
        onClick={() => {
          if (!busy) onClose();
        }}
      />
      <div className="relative z-10 w-full max-w-md rounded-2xl border border-[var(--border-strong)] bg-[var(--bg-elevated)] p-5 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2
              id={titleId}
              className="text-base font-semibold text-[var(--fg)]"
            >
              New dataset
            </h2>
            <p className="mt-1 text-[12px] leading-relaxed text-[var(--fg-muted)]">
              Create a workspace with <strong>one</strong> starter document.
              Open that dataset later to <strong>Add document</strong> if you
              need more sources.
            </p>
          </div>
          <button
            type="button"
            className="rounded-lg p-1.5 text-[var(--fg-subtle)] hover:bg-[var(--surface-hover)]"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 space-y-3">
          <div>
            <label
              htmlFor={titleId + "-input"}
              className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-[var(--fg-subtle)]"
            >
              Dataset name
            </label>
            <input
              id={titleId + "-input"}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Defaults from file name"
              className="field !min-h-10 !text-sm"
              disabled={busy}
              autoComplete="off"
            />
          </div>

          <div>
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-[var(--fg-subtle)]">
              Starter document (required · one file)
            </span>
            <label
              htmlFor={fileId}
              className={cn(
                "flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed border-[var(--violet-border)] bg-[var(--violet-soft)] px-4 py-5 text-center transition hover:border-[var(--mood-border)] hover:bg-[var(--mood-soft)]",
                busy && "pointer-events-none opacity-60",
              )}
            >
              <FileUp className="h-6 w-6 text-[var(--violet)]" />
              <span className="text-sm font-semibold text-[var(--fg)]">
                {file ? file.name : "Choose one file"}
              </span>
              <span className="text-[11px] text-[var(--fg-subtle)]">
                PDF · TXT · MD · CSV · JSON · max one file per create
              </span>
              <input
                ref={fileRef}
                id={fileId}
                type="file"
                className="hidden"
                accept={ACCEPT}
                disabled={busy}
                // single file only — no multiple attribute
                onChange={(e) => {
                  pickFile(e.target.files?.[0]);
                  // allow re-picking same path later
                  e.target.value = "";
                }}
              />
            </label>
            {file && (
              <p className="mt-1.5 text-[11px] text-[var(--fg-muted)]">
                {(file.size / 1024).toFixed(1)} KB · you can rename the dataset
                above
              </p>
            )}
          </div>

          {(localError || error) && (
            <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-800">
              {localError || error}
            </p>
          )}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            className="btn-secondary !min-h-10"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary !min-h-10"
            onClick={submit}
            disabled={busy || !file}
          >
            {busy ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Creating…
              </>
            ) : (
              "Create & upload"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
