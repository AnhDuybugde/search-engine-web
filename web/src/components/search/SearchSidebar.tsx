"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Check,
  Loader2,
  MessageSquarePlus,
  PanelLeft,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/Logo";
import { UserMenu } from "@/components/UserMenu";
import type { SessionSummary } from "@/lib/hooks/use-search-chat";

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

export function SearchSidebar({
  sessions,
  currentId,
  loading,
  onNew,
  onSelect,
  onRename,
  onRequestDelete,
  onCollapse,
  className,
}: {
  sessions: SessionSummary[];
  currentId: string | null;
  loading?: boolean;
  onNew: () => void;
  onSelect: (id: string) => void;
  onRename: (id: string, title: string) => Promise<void>;
  /** Opens in-app confirm dialog — does not delete immediately */
  onRequestDelete: (id: string, title: string) => void;
  /** Desktop-only collapse control for the resizable sessions panel. */
  onCollapse?: () => void;
  className?: string;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const startEdit = (s: SessionSummary) => {
    setEditingId(s.id);
    setEditTitle(s.title);
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
    <aside className={cn("chat-sidebar", className)} aria-label="Sessions">
      <div className="chat-sidebar-header">
        <Link href="/" className="chat-sidebar-brand" aria-label="SearchEngine home">
          <Logo className="h-7 w-7" showWordmark />
        </Link>
        <div className="chat-sidebar-header-row">
          <div className="chat-sidebar-heading truncate">Sessions</div>
          <div className="flex items-center gap-1">
            {onCollapse && (
              <button
                type="button"
                onClick={onCollapse}
                className="btn-ghost hidden !min-h-8 !rounded-lg !px-2 xl:inline-flex"
                aria-label="Collapse sessions panel"
                title="Collapse sessions"
              >
                <PanelLeft className="h-3.5 w-3.5" />
              </button>
            )}
            <button
              type="button"
              onClick={onNew}
              className="btn-primary !min-h-8 !gap-1 !px-2.5 !text-xs !shadow-sm"
            >
              <Plus className="h-3.5 w-3.5" />
              New
            </button>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {loading && !sessions.length ? (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-[var(--fg-muted)]">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : !sessions.length ? (
          <div className="mx-1 mt-3 rounded-xl border border-dashed border-[var(--border-strong)] bg-[var(--bg-panel)] px-3 py-8 text-center">
            <MessageSquarePlus className="mx-auto h-7 w-7 text-[var(--accent)]" />
            <p className="mt-2 text-sm font-semibold text-[var(--fg)]">
              No sessions yet
            </p>
            <p className="mt-1 text-ui-xs leading-relaxed text-[var(--fg-muted)]">
              Start a new chat to search the web with multi-turn memory.
            </p>
            <button
              type="button"
              onClick={onNew}
              className="btn-secondary mt-3 !min-h-9 !text-sm"
            >
              <Plus className="h-4 w-4" />
              New session
            </button>
          </div>
        ) : (
          <ul
            className="space-y-1"
            role="listbox"
            aria-label="Session list"
            aria-activedescendant={
              currentId ? `session-option-${currentId}` : undefined
            }
          >
            {sessions.map((s) => {
              const active = s.id === currentId;
              const editing = editingId === s.id;
              return (
                <li key={s.id} role="presentation">
                  <div
                    id={`session-option-${s.id}`}
                    role="option"
                    aria-selected={active}
                    className={cn(
                      "chat-sidebar-item group",
                      active && "chat-sidebar-item--active",
                    )}
                  >
                    {editing ? (
                      <div className="flex min-w-0 flex-1 items-center gap-1">
                        <input
                          value={editTitle}
                          onChange={(e) => setEditTitle(e.target.value)}
                          className="field !min-h-9 flex-1 !px-2.5 !py-1 !text-sm"
                          autoFocus
                          aria-label="Session title"
                          onKeyDown={(e) => {
                            if (e.key === "Enter") void saveEdit();
                            if (e.key === "Escape") setEditingId(null);
                          }}
                        />
                        <button
                          type="button"
                          className="rounded-md p-2 text-emerald-700 hover:bg-emerald-50"
                          onClick={() => void saveEdit()}
                          disabled={busyId === s.id}
                          aria-label="Save title"
                        >
                          <Check className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          className="rounded-md p-2 text-[var(--fg-subtle)] hover:bg-[var(--surface)]"
                          onClick={() => setEditingId(null)}
                          aria-label="Cancel rename"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => onSelect(s.id)}
                          className="min-w-0 flex-1 cursor-pointer text-left"
                          aria-current={active ? "true" : undefined}
                        >
                          <div className="chat-sidebar-item-title">{s.title}</div>
                          <div className="chat-sidebar-item-meta">
                            {active ? (
                              <span className="mr-1.5 inline-flex items-center rounded-md bg-[var(--mood-soft)] px-1.5 py-px text-[11px] font-semibold uppercase tracking-wide text-[var(--mood)] ring-1 ring-[var(--mood-border)]">
                                Active
                              </span>
                            ) : null}
                            {relativeTime(s.updatedAt || s.createdAt)}
                          </div>
                        </button>
                        <div className="flex shrink-0 opacity-100 sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                          <button
                            type="button"
                            className="rounded-lg p-2 text-[var(--fg-subtle)] hover:bg-[var(--surface)] hover:text-[var(--fg)]"
                            onClick={() => startEdit(s)}
                            aria-label="Rename"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            className="rounded-lg p-2 text-[var(--fg-subtle)] hover:bg-[var(--danger-soft)] hover:text-[var(--danger)]"
                            onClick={() => onRequestDelete(s.id, s.title)}
                            aria-label={`Delete ${s.title}`}
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
      <div className="chat-sidebar-account">
        <UserMenu variant="sidebar" />
      </div>
    </aside>
  );
}
