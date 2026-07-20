"use client";

import { BookOpen, Loader2, PanelLeftClose, Plus, Trash2 } from "lucide-react";
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
  currentId: string | null;
  loading?: boolean;
  onNew: () => void;
  onSelect: (id: string) => void;
  onDelete: (id: string, title: string) => void;
  /** Desktop collapse (optional). */
  onCollapse?: () => void;
  className?: string;
}) {
  return (
    <aside className={cn("chat-sidebar", className)}>
      <div className="chat-sidebar-header">
        <div className="flex min-w-0 items-center gap-2 text-sm font-semibold text-[var(--fg)]">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[var(--primary-soft)] text-[var(--primary)] ring-1 ring-[var(--primary-border)]">
            <BookOpen className="h-3.5 w-3.5" aria-hidden />
          </span>
          <span className="truncate">Datasets</span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={onNew}
            className="inline-flex h-8 items-center gap-1 rounded-lg bg-[var(--primary)] px-2.5 text-xs font-semibold text-white shadow-sm transition hover:bg-[#4338ca]"
          >
            <Plus className="h-3.5 w-3.5" />
            New
          </button>
          {onCollapse && (
            <button
              type="button"
              onClick={onCollapse}
              className="hidden h-8 w-8 items-center justify-center rounded-lg text-[var(--fg-muted)] transition hover:bg-[var(--surface-hover)] hover:text-[var(--fg)] xl:inline-flex"
              aria-label="Collapse datasets panel"
              title="Collapse"
            >
              <PanelLeftClose className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {loading && !items.length ? (
          <div className="flex items-center justify-center gap-2 py-10 text-xs text-[var(--fg-muted)]">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : !items.length ? (
          <p className="px-3 py-10 text-center text-xs leading-relaxed text-[var(--fg-muted)]">
            No datasets yet. Click{" "}
            <strong className="text-[var(--fg)]">New</strong> to create a
            workspace, store raw sources, then chat.
          </p>
        ) : (
          <ul className="space-y-0.5">
            {items.map((n) => {
              const active = n.id === currentId;
              return (
                <li key={n.id}>
                  <div
                    className={cn(
                      "chat-sidebar-item group",
                      active && "chat-sidebar-item--active",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => onSelect(n.id)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <div className="truncate text-[13px] font-medium text-[var(--fg)]">
                        {n.title}
                      </div>
                      <div className="mt-0.5 text-[11px] text-[var(--fg-subtle)]">
                        {relativeTime(n.updatedAt || n.createdAt)}
                      </div>
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete ${n.title}`}
                      onClick={() => onDelete(n.id, n.title)}
                      className="mt-0.5 rounded p-1 text-[var(--fg-subtle)] opacity-0 transition-opacity hover:bg-[var(--danger-soft)] hover:text-[var(--danger)] group-hover:opacity-100"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
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
