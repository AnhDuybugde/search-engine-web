"use client";

import { useMemo, useState } from "react";
import {
  BookOpen,
  Check,
  FolderPlus,
  Loader2,
  Lock,
  LockOpen,
  PanelLeftClose,
  Pencil,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type DatasetSummary = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt?: string;
  locked?: boolean;
  indexStatus?: string;
  indexMessage?: string | null;
  unitCount?: number;
  embeddedCount?: number;
};

function relativeTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const diff = Date.now() - t;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 14) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function DatasetSidebar({
  items,
  currentId,
  checkedIds,
  loading,
  onNew,
  onSelect,
  onToggleCheck,
  onRename,
  onToggleLock,
  onDelete,
  onCollapse,
  className,
}: {
  items: DatasetSummary[];
  /** Open workspace (route id) for upload/history UI */
  currentId: string | null;
  /** Datasets included in retrieval (checkbox multi-select) */
  checkedIds: string[];
  loading?: boolean;
  onNew: () => void;
  onSelect: (id: string) => void;
  onToggleCheck: (id: string, checked: boolean) => void;
  onRename: (id: string, title: string) => Promise<void>;
  /** Lock / unlock to prevent accidental delete */
  onToggleLock?: (id: string, locked: boolean) => Promise<void>;
  onDelete: (id: string, title: string) => void;
  onCollapse?: () => void;
  className?: string;
}) {
  const [query, setQuery] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((n) => n.title.toLowerCase().includes(q));
  }, [items, query]);

  const checkedCount = checkedIds.length;

  const startEdit = (n: DatasetSummary) => {
    setEditingId(n.id);
    setEditTitle(n.title);
  };

  const saveEdit = async () => {
    if (!editingId || !editTitle.trim()) return;
    setBusyId(editingId);
    try {
      await onRename(editingId, editTitle.trim());
      setEditingId(null);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <aside className={cn("chat-sidebar", className)} aria-label="Datasets">
      <div className="chat-sidebar-header">
        <div className="min-w-0">
          <div className="chat-sidebar-heading truncate">Datasets</div>
          <div className="chat-sidebar-sub truncate">
            Check to chat · lock to protect · open to manage
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={onNew}
            className="btn-primary !min-h-9 !gap-1.5 !px-3 !text-sm !shadow-sm"
            title="Create dataset with one starter file (add more later from that open dataset)"
            aria-label="New dataset"
          >
            <Plus className="h-4 w-4" />
            New dataset
          </button>
          {onCollapse && (
            <button
              type="button"
              onClick={onCollapse}
              className="hidden h-9 w-9 items-center justify-center rounded-lg text-[var(--fg-muted)] transition hover:bg-[var(--surface-hover)] hover:text-[var(--fg)] xl:inline-flex"
              aria-label="Collapse datasets panel"
              title="Collapse"
            >
              <PanelLeftClose className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {items.length > 0 && (
        <div className="shrink-0 border-b border-[var(--border)] px-2.5 py-2">
          <label className="relative block">
            <span className="sr-only">Filter datasets</span>
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--fg-subtle)]" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find a dataset…"
              className="field !min-h-10 !pl-9 !pr-3 !text-sm"
              autoComplete="off"
            />
          </label>
          <p className="mt-1.5 px-0.5 text-ui-xs text-[var(--fg-subtle)]">
            {checkedCount > 0 ? (
              <>
                <strong className="text-[var(--fg-muted)]">{checkedCount}</strong>{" "}
                selected for chat · click name to open · pencil to rename
              </>
            ) : (
              <>
                Tick datasets to chat · open one to Add document · New =
                one starter file
              </>
            )}
          </p>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {loading && !items.length ? (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-[var(--fg-muted)]">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : !items.length ? (
          <div className="mx-1 mt-3 rounded-xl border border-dashed border-[var(--border-strong)] bg-[var(--bg-panel)] px-3 py-8 text-center">
            <FolderPlus className="mx-auto h-7 w-7 text-[var(--accent)]" />
            <p className="mt-2 text-sm font-semibold text-[var(--fg)]">
              No datasets yet
            </p>
            <p className="mt-1 text-ui-xs leading-relaxed text-[var(--fg-muted)]">
              New dataset takes one starter document. Open it later to add more
              sources, then chat with retrieval and process lab tools.
            </p>
            <button
              type="button"
              onClick={onNew}
              className="btn-secondary mt-3 !min-h-9 !text-sm"
            >
              <Plus className="h-4 w-4" />
              New dataset
            </button>
          </div>
        ) : !filtered.length ? (
          <p className="px-2 py-8 text-center text-sm text-[var(--fg-muted)]">
            No datasets match “{query.trim()}”
          </p>
        ) : (
          <ul className="space-y-1" aria-label="Dataset list">
            {filtered.map((n) => {
              const active = n.id === currentId;
              const checked = checkedIds.includes(n.id);
              const editing = editingId === n.id;
              return (
                <li key={n.id}>
                  <div
                    className={cn(
                      "chat-sidebar-item group",
                      active && "chat-sidebar-item--active",
                      checked && !active && "ring-1 ring-[var(--mood-border)]/60",
                    )}
                  >
                    <label
                      className="mt-1 flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center"
                      title={
                        checked
                          ? "Included in chat retrieval"
                          : "Include this dataset in chat"
                      }
                    >
                      <span className="sr-only">
                        Use dataset {n.title} for retrieval
                      </span>
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-[var(--border-strong)] text-[var(--accent)] focus:ring-[var(--ring)]"
                        checked={checked}
                        onChange={(e) => {
                          e.stopPropagation();
                          onToggleCheck(n.id, e.target.checked);
                        }}
                        onClick={(e) => e.stopPropagation()}
                      />
                    </label>

                    {editing ? (
                      <div className="flex min-w-0 flex-1 items-center gap-1">
                        <input
                          value={editTitle}
                          onChange={(e) => setEditTitle(e.target.value)}
                          className="field !min-h-9 flex-1 !px-2.5 !py-1 !text-sm"
                          autoFocus
                          aria-label="Dataset name"
                          onKeyDown={(e) => {
                            if (e.key === "Enter") void saveEdit();
                            if (e.key === "Escape") setEditingId(null);
                          }}
                        />
                        <button
                          type="button"
                          className="rounded-md p-2 text-emerald-700 hover:bg-emerald-50"
                          onClick={() => void saveEdit()}
                          disabled={busyId === n.id}
                          aria-label="Save name"
                        >
                          <Check className="h-4 w-4" />
                        </button>
                      </div>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => onSelect(n.id)}
                          className="flex min-w-0 flex-1 cursor-pointer items-start gap-2 text-left"
                          aria-current={active ? "true" : undefined}
                        >
                          <span
                            className={cn(
                              "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
                              active
                                ? "bg-[var(--accent)] text-white shadow-sm"
                                : "bg-[var(--bg-panel)] text-[var(--fg-muted)] ring-1 ring-[var(--border)]",
                            )}
                            aria-hidden
                          >
                            <BookOpen className="h-4 w-4" />
                          </span>
                          <span className="min-w-0">
                            <span className="chat-sidebar-item-title">
                              {n.title}
                            </span>
                            <span className="chat-sidebar-item-meta">
                              {active ? (
                                <span className="mr-1.5 inline-flex items-center rounded-md bg-[var(--mood-soft)] px-1.5 py-px text-[11px] font-semibold uppercase tracking-wide text-[var(--mood)] ring-1 ring-[var(--mood-border)]">
                                  Open
                                </span>
                              ) : null}
                              {checked ? (
                                <span className="mr-1.5 inline-flex items-center rounded-md bg-[var(--teal-soft)] px-1.5 py-px text-[11px] font-semibold uppercase tracking-wide text-[var(--teal)] ring-1 ring-[var(--teal-border)]">
                                  In use
                                </span>
                              ) : null}
                              {n.locked ? (
                                <span className="mr-1.5 inline-flex items-center gap-0.5 rounded-md bg-amber-50 px-1.5 py-px text-[11px] font-semibold uppercase tracking-wide text-amber-800 ring-1 ring-amber-600/25">
                                  <Lock className="h-2.5 w-2.5" />
                                  Locked
                                </span>
                              ) : null}
                              {n.indexStatus === "ready" ? (
                                <span className="mr-1.5 inline-flex items-center rounded-md bg-emerald-50 px-1.5 py-px text-[11px] font-semibold uppercase tracking-wide text-emerald-800 ring-1 ring-emerald-600/25">
                                  Indexed
                                  {typeof n.embeddedCount === "number"
                                    ? ` · ${n.embeddedCount}`
                                    : ""}
                                </span>
                              ) : n.indexStatus === "indexing" ? (
                                <span className="mr-1.5 inline-flex items-center rounded-md bg-sky-50 px-1.5 py-px text-[11px] font-semibold uppercase tracking-wide text-sky-800 ring-1 ring-sky-600/25">
                                  Indexing…
                                </span>
                              ) : n.indexStatus === "failed" ? (
                                <span className="mr-1.5 inline-flex items-center rounded-md bg-rose-50 px-1.5 py-px text-[11px] font-semibold uppercase tracking-wide text-rose-700 ring-1 ring-rose-500/30">
                                  Index fail
                                </span>
                              ) : n.indexStatus === "skipped" ? (
                                <span className="mr-1.5 inline-flex items-center rounded-md bg-[var(--bg-panel)] px-1.5 py-px text-[11px] font-semibold uppercase tracking-wide text-[var(--fg-muted)] ring-1 ring-[var(--border)]">
                                  No embed
                                </span>
                              ) : null}
                              {relativeTime(n.updatedAt || n.createdAt)}
                            </span>
                          </span>
                        </button>
                        <div className="flex shrink-0 opacity-100 sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                          {onToggleLock && (
                            <button
                              type="button"
                              className={cn(
                                "rounded-lg p-2 hover:bg-[var(--surface)]",
                                n.locked
                                  ? "text-amber-700 hover:text-amber-900"
                                  : "text-[var(--fg-subtle)] hover:text-[var(--fg)]",
                              )}
                              onClick={(e) => {
                                e.stopPropagation();
                                setBusyId(n.id);
                                void onToggleLock(n.id, !n.locked).finally(() =>
                                  setBusyId(null),
                                );
                              }}
                              disabled={busyId === n.id}
                              aria-label={
                                n.locked
                                  ? `Unlock ${n.title}`
                                  : `Lock ${n.title}`
                              }
                              title={
                                n.locked
                                  ? "Unlock (allow delete)"
                                  : "Lock (prevent delete)"
                              }
                            >
                              {n.locked ? (
                                <Lock className="h-4 w-4" />
                              ) : (
                                <LockOpen className="h-4 w-4" />
                              )}
                            </button>
                          )}
                          <button
                            type="button"
                            className="rounded-lg p-2 text-[var(--fg-subtle)] hover:bg-[var(--surface)] hover:text-[var(--fg)]"
                            onClick={(e) => {
                              e.stopPropagation();
                              startEdit(n);
                            }}
                            aria-label={`Rename ${n.title}`}
                            title="Rename"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            aria-label={`Delete ${n.title}`}
                            title={
                              n.locked
                                ? "Unlock this dataset before deleting"
                                : "Delete dataset"
                            }
                            disabled={Boolean(n.locked)}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (n.locked) return;
                              onDelete(n.id, n.title);
                            }}
                            className={cn(
                              "rounded-lg p-2",
                              n.locked
                                ? "cursor-not-allowed text-[var(--fg-subtle)] opacity-40"
                                : "text-[var(--fg-subtle)] hover:bg-[var(--danger-soft)] hover:text-[var(--danger)]",
                            )}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}
