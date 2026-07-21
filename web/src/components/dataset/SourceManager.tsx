"use client";

import { useRef, useState } from "react";
import {
  Check,
  FileText,
  Loader2,
  MoreHorizontal,
  Pencil,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import type { UploadSseState } from "@/lib/hooks/use-upload-sse";

export type ManagedSource = {
  id: string;
  title: string;
  mime: string | null;
  charCount: number;
  createdAt: string;
};

function sourceType(source: ManagedSource) {
  if (source.mime?.includes("pdf") || source.title.toLowerCase().endsWith(".pdf")) {
    return "PDF";
  }
  const ext = source.title.split(".").pop()?.toUpperCase();
  return ext && ext.length <= 5 ? ext : "FILE";
}

function relativeTime(iso: string) {
  const diff = Math.max(0, Date.now() - new Date(iso).getTime());
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function SourceManager({
  notebookId,
  sources,
  uploadState,
  onUpload,
  onRefresh,
}: {
  notebookId: string;
  sources: ManagedSource[];
  uploadState: UploadSseState;
  onUpload: (file: File) => Promise<void>;
  onRefresh: () => Promise<void>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ManagedSource | null>(null);
  const [optimisticDeletedIds, setOptimisticDeletedIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [backgroundDelete, setBackgroundDelete] = useState<ManagedSource | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  const uploadBusy = uploadState.status === "running";
  const visibleSources = sources.filter((source) => !optimisticDeletedIds.has(source.id));

  const beginRename = (source: ManagedSource) => {
    setMenuId(null);
    setEditingId(source.id);
    setEditTitle(source.title);
    setError(null);
  };

  const saveRename = async () => {
    if (!editingId || !editTitle.trim()) return;
    setBusyId(editingId);
    setError(null);
    try {
      const res = await fetch(`/api/notebooks/${notebookId}/sources/${editingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: editTitle.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Rename failed");
      setEditingId(null);
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Rename failed");
    } finally {
      setBusyId(null);
    }
  };

  const deleteInBackground = (source: ManagedSource) => {
    setPendingDelete(null);
    setError(null);
    setOptimisticDeletedIds((prev) => new Set(prev).add(source.id));
    setBackgroundDelete(source);

    void (async () => {
      try {
        const res = await fetch(`/api/notebooks/${notebookId}/sources/${source.id}`, {
          method: "DELETE",
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Delete failed");
        await onRefresh();
        setOptimisticDeletedIds((prev) => {
          const next = new Set(prev);
          next.delete(source.id);
          return next;
        });
      } catch (err) {
        setOptimisticDeletedIds((prev) => {
          const next = new Set(prev);
          next.delete(source.id);
          return next;
        });
        setError(
          err instanceof Error
            ? `Could not remove “${source.title}”: ${err.message}`
            : `Could not remove “${source.title}”`,
        );
      } finally {
        setBackgroundDelete((current) =>
          current?.id === source.id ? null : current,
        );
      }
    })();
  };

  return (
    <div className="space-y-3" onClick={() => setMenuId(null)}>
      <div className="flex items-start justify-between gap-2 rounded-lg border border-[var(--border)] bg-[var(--bg-panel)] px-2.5 py-2">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--fg-subtle)]">
            Sources
          </p>
          <p className="mt-0.5 text-[12px] text-[var(--fg)]">
            <strong>{sources.length}</strong> document{sources.length === 1 ? "" : "s"}
          </p>
          <p className="mt-0.5 text-[10px] leading-relaxed text-[var(--fg-subtle)]">
            Add, rename, or remove sources without leaving this workspace.
          </p>
        </div>
        <>
          <input
            ref={inputRef}
            type="file"
            className="hidden"
            accept=".pdf,.txt,.md,.markdown,.csv,.json,text/plain,text/csv,application/pdf,application/csv"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void onUpload(file);
            }}
          />
          <button
            type="button"
            className="btn-primary !min-h-10 !shrink-0 !gap-1.5 !rounded-lg !px-2.5 !text-xs"
            onClick={() => inputRef.current?.click()}
            disabled={uploadBusy}
            aria-label="Add source"
          >
            {uploadBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
            Add
          </button>
        </>
      </div>

      {uploadBusy && (
        <div className="flex items-center gap-2 rounded-lg border border-[var(--primary-border)] bg-[var(--primary-soft)] px-2.5 py-2 text-[11px] text-[var(--fg)]" role="status" aria-live="polite">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--primary)]" />
          <span className="min-w-0 flex-1 truncate">Processing {uploadState.filename || "source"}…</span>
          <span className="font-mono text-[10px] text-[var(--fg-muted)]">{uploadState.indexPercent != null ? `${uploadState.indexPercent}%` : "in progress"}</span>
        </div>
      )}

      {backgroundDelete && (
        <div
          className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-50 px-2.5 py-2 text-[11px] text-amber-900"
          role="status"
          aria-live="polite"
        >
          <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-700" />
          <span className="min-w-0 flex-1 truncate">
            Removing {backgroundDelete.title}…
          </span>
          <span className="text-[10px] text-amber-700">in background</span>
        </div>
      )}

      {error && <p className="text-[11px] text-[var(--danger)]" role="alert">{error}</p>}

      {visibleSources.length ? (
        <ul className="space-y-1.5" aria-label="Source list">
          {visibleSources.map((source) => {
            const editing = editingId === source.id;
            const busy = busyId === source.id;
            return (
              <li key={source.id} className="group relative rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2.5 transition-colors hover:border-[var(--border-strong)]">
                <div className="flex items-start gap-2">
                  <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[var(--primary-soft)] text-[var(--primary)]">
                    <FileText className="h-3.5 w-3.5" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    {editing ? (
                      <form
                        className="flex items-center gap-1.5"
                        onSubmit={(event) => {
                          event.preventDefault();
                          void saveRename();
                        }}
                      >
                        <label className="sr-only" htmlFor={`source-name-${source.id}`}>Source name</label>
                        <input
                          id={`source-name-${source.id}`}
                          autoFocus
                          value={editTitle}
                          onChange={(event) => setEditTitle(event.target.value)}
                          maxLength={200}
                          className="input h-8 min-w-0 flex-1 px-2 text-xs"
                          disabled={busy}
                        />
                        <button type="submit" className="btn-icon !h-8 !w-8" disabled={busy || !editTitle.trim()} aria-label="Save source name">
                          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                        </button>
                        <button type="button" className="btn-icon !h-8 !w-8" disabled={busy} onClick={() => setEditingId(null)} aria-label="Cancel rename">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </form>
                    ) : (
                      <p className="truncate text-[12px] font-medium text-[var(--fg)]" title={source.title}>{source.title}</p>
                    )}
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-[var(--fg-subtle)]">
                      <span>{source.charCount.toLocaleString()} chars</span>
                      <span aria-hidden>·</span>
                      <span>{sourceType(source)}</span>
                      <span aria-hidden>·</span>
                      <span>{relativeTime(source.createdAt)}</span>
                    </div>
                  </div>
                  {!editing && (
                    <div className="relative shrink-0" onClick={(event) => event.stopPropagation()}>
                      <button type="button" className="btn-icon !h-8 !w-8" onClick={() => setMenuId(menuId === source.id ? null : source.id)} aria-label={`Actions for ${source.title}`} aria-expanded={menuId === source.id}>
                        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MoreHorizontal className="h-4 w-4" />}
                      </button>
                      {menuId === source.id && !busy && (
                        <div className="absolute right-0 top-9 z-20 w-32 rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] p-1 shadow-[var(--shadow-md)]">
                          <button type="button" className="flex min-h-9 w-full items-center gap-2 rounded-md px-2 text-left text-xs text-[var(--fg)] hover:bg-[var(--surface-hover)]" onClick={() => beginRename(source)}>
                            <Pencil className="h-3.5 w-3.5" /> Rename
                          </button>
                          <button type="button" className="flex min-h-9 w-full items-center gap-2 rounded-md px-2 text-left text-xs text-rose-700 hover:bg-rose-50" onClick={() => { setMenuId(null); setPendingDelete(source); }}>
                            <Trash2 className="h-3.5 w-3.5" /> Delete
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="rounded-lg border border-dashed border-[var(--border-strong)] bg-[var(--bg-panel)] px-3 py-5 text-center">
          <FileText className="mx-auto h-5 w-5 text-[var(--fg-subtle)]" aria-hidden />
          <p className="mt-2 text-xs font-medium text-[var(--fg-muted)]">No sources yet</p>
          <p className="mt-1 text-[10px] leading-relaxed text-[var(--fg-subtle)]">Add a PDF, TXT, Markdown, CSV, or JSON file to start.</p>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="Delete this source?"
        description="The source and its stored retrieval index will be removed from this dataset. This cannot be undone."
        resourceLabel={pendingDelete?.title}
        confirmLabel="Delete source"
        cancelLabel="Keep source"
        busy={busyId === pendingDelete?.id}
        onCancel={() => {
          if (!busyId) setPendingDelete(null);
        }}
        onConfirm={() => {
          if (pendingDelete) deleteInBackground(pendingDelete);
        }}
      />
    </div>
  );
}
