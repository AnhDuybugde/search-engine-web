"use client";

import { useMemo, useState } from "react";
import {
  BookOpen,
  Check,
  FolderPlus,
  Loader2,
  PanelLeftClose,
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
  loading,
  onNew,
  onSelect,
  onDelete,
  onCollapse,
  className,
}: {
  items: DatasetSummary[];
  /** Exactly one active dataset (route id) or null when none selected */
  currentId: string | null;
  loading?: boolean;
  onNew: () => void;
  onSelect: (id: string) => void;
  onDelete: (id: string, title: string) => void;
  /** Desktop collapse (optional). */
  onCollapse?: () => void;
  className?: string;
}) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((n) => n.title.toLowerCase().includes(q));
  }, [items, query]);

  return (
    <aside className={cn("chat-sidebar", className)} aria-label="Datasets">
      <div className="chat-sidebar-header">
        <div className="min-w-0">
          <div className="chat-sidebar-heading truncate">Datasets</div>
          <div className="chat-sidebar-sub truncate">
            Select one workspace to chat
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={onNew}
            className="btn-primary !min-h-9 !gap-1.5 !px-3 !text-sm !shadow-sm"
            title="Create a new dataset"
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
          {currentId && (
            <p className="mt-1.5 px-0.5 text-ui-xs text-[var(--fg-subtle)]">
              One active dataset at a time · click a row to open
            </p>
          )}
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
              Create a workspace, store raw sources, then chat with retrieval
              and process lab tools.
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
          <ul
            className="space-y-1"
            role="listbox"
            aria-label="Dataset list"
            aria-activedescendant={
              currentId ? `dataset-option-${currentId}` : undefined
            }
          >
            {filtered.map((n) => {
              const active = n.id === currentId;
              return (
                <li key={n.id} role="presentation">
                  <div
                    id={`dataset-option-${n.id}`}
                    role="option"
                    aria-selected={active}
                    className={cn(
                      "chat-sidebar-item group",
                      active && "chat-sidebar-item--active",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => onSelect(n.id)}
                      className="flex min-w-0 flex-1 cursor-pointer items-start gap-2.5 text-left"
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
                        {active ? (
                          <Check className="h-4 w-4" strokeWidth={2.5} />
                        ) : (
                          <BookOpen className="h-4 w-4" />
                        )}
                      </span>
                      <span className="min-w-0">
                        <span className="chat-sidebar-item-title">{n.title}</span>
                        <span className="chat-sidebar-item-meta">
                          {active ? (
                            <span className="mr-1.5 inline-flex items-center rounded-md bg-[var(--mood-soft)] px-1.5 py-px text-[11px] font-semibold uppercase tracking-wide text-[var(--mood)] ring-1 ring-[var(--mood-border)]">
                              Active
                            </span>
                          ) : null}
                          {relativeTime(n.updatedAt || n.createdAt)}
                        </span>
                      </span>
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete ${n.title}`}
                      title="Delete dataset"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete(n.id, n.title);
                      }}
                      className="mt-0.5 rounded-lg p-2 text-[var(--fg-subtle)] opacity-100 transition hover:bg-[var(--danger-soft)] hover:text-[var(--danger)] sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
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
