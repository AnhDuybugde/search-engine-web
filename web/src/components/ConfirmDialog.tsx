"use client";

import { useEffect, useId, useRef } from "react";
import { AlertTriangle, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";

export type ConfirmDialogProps = {
  open: boolean;
  title: string;
  description?: string;
  /** Name of the resource being deleted — shown in bold */
  resourceLabel?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  busy?: boolean;
  /** destructive = red primary action (default) */
  tone?: "danger" | "primary";
  onConfirm: () => void;
  onCancel: () => void;
};

/**
 * In-app confirm modal (center of viewport). Replaces browser `confirm()` so
 * delete flows stay on-brand and keyboard-accessible.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  resourceLabel,
  confirmLabel = "Delete",
  cancelLabel = "Cancel",
  busy = false,
  tone = "danger",
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const titleId = useId();
  const descId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const t = window.setTimeout(() => cancelRef.current?.focus(), 0);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onCancel();
    };
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.clearTimeout(t);
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      prev?.focus?.();
    };
  }, [open, busy, onCancel]);

  if (!open) return null;

  return (
    <div className="confirm-root" role="presentation">
      <button
        type="button"
        className="confirm-backdrop"
        aria-label="Dismiss"
        disabled={busy}
        onClick={() => {
          if (!busy) onCancel();
        }}
      />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description || resourceLabel ? descId : undefined}
        className="confirm-panel anim-enter"
      >
        <div className="flex items-start gap-3">
          <span
            className={cn(
              "mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ring-1",
              tone === "danger"
                ? "bg-[var(--danger-soft)] text-[var(--danger)] ring-[var(--danger)]/20"
                : "bg-[var(--mood-soft)] text-[var(--mood)] ring-[var(--mood-border)]",
            )}
            aria-hidden
          >
            <AlertTriangle className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2
              id={titleId}
              className="text-base font-semibold tracking-tight text-[var(--fg)]"
              style={{ fontFamily: "var(--font-display)" }}
            >
              {title}
            </h2>
            <div
              id={descId}
              className="mt-1.5 text-sm leading-relaxed text-[var(--fg-muted)]"
            >
              {description ||
                "This action cannot be undone. Related sources and chat history for this item will be removed."}
              {resourceLabel ? (
                <p className="mt-2 rounded-lg border border-[var(--border)] bg-[var(--bg-panel)] px-2.5 py-2 text-sm font-medium text-[var(--fg)]">
                  {resourceLabel}
                </p>
              ) : null}
            </div>
          </div>
          <button
            type="button"
            className="rounded-lg p-1.5 text-[var(--fg-subtle)] hover:bg-[var(--surface-hover)] hover:text-[var(--fg)]"
            onClick={onCancel}
            disabled={busy}
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            className="btn-secondary !min-h-10 !px-4 !text-sm"
            onClick={onCancel}
            disabled={busy}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className={cn(
              "inline-flex min-h-10 items-center justify-center gap-2 rounded-[var(--radius-sm)] px-4 text-sm font-semibold text-white shadow-sm transition disabled:opacity-50",
              tone === "danger"
                ? "bg-[var(--danger)] hover:brightness-110"
                : "btn-primary !min-h-10",
            )}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Deleting…
              </>
            ) : (
              confirmLabel
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
