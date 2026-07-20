"use client";

import { useState } from "react";
import {
  Check,
  Loader2,
  MessageSquare,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
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
  onDelete,
  className,
}: {
  sessions: SessionSummary[];
  currentId: string | null;
  loading?: boolean;
  onNew: () => void;
  onSelect: (id: string) => void;
  onRename: (id: string, title: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
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
    <aside className={cn("chat-sidebar", className)}>
      <div className="chat-sidebar-header">
        <div className="flex items-center gap-2 text-sm font-semibold text-[var(--fg)]">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--primary-soft)] text-[var(--primary)] ring-1 ring-[var(--primary-border)]">
            <MessageSquare className="h-3.5 w-3.5" aria-hidden />
          </span>
          Chats
        </div>
        <button
          type="button"
          onClick={onNew}
          className="inline-flex h-8 items-center gap-1 rounded-lg bg-[var(--primary)] px-2.5 text-xs font-semibold text-white shadow-sm transition hover:bg-[#4338ca]"
        >
          <Plus className="h-3.5 w-3.5" />
          New
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {loading && !sessions.length ? (
          <div className="flex items-center justify-center gap-2 py-10 text-xs text-[var(--fg-muted)]">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : !sessions.length ? (
          <p className="px-3 py-10 text-center text-xs leading-relaxed text-[var(--fg-muted)]">
            No chats yet. Click <strong className="text-[var(--fg)]">New</strong>{" "}
            to start a web research session.
          </p>
        ) : (
          <ul className="space-y-0.5">
            {sessions.map((s) => {
              const active = s.id === currentId;
              const editing = editingId === s.id;
              return (
                <li key={s.id}>
                  <div
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
                          className="field !min-h-8 flex-1 !px-2 !py-1 text-xs"
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === "Enter") void saveEdit();
                            if (e.key === "Escape") setEditingId(null);
                          }}
                        />
                        <button
                          type="button"
                          className="rounded p-1 text-emerald-700 hover:bg-emerald-50"
                          onClick={() => void saveEdit()}
                          disabled={busyId === s.id}
                        >
                          <Check className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          className="rounded p-1 text-[var(--fg-subtle)] hover:bg-[var(--surface)]"
                          onClick={() => setEditingId(null)}
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => onSelect(s.id)}
                          className="min-w-0 flex-1 text-left"
                        >
                          <div className="truncate text-[13px] font-medium text-[var(--fg)]">
                            {s.title}
                          </div>
                          <div className="mt-0.5 text-[11px] text-[var(--fg-subtle)]">
                            {relativeTime(s.updatedAt || s.createdAt)}
                          </div>
                        </button>
                        <div className="flex shrink-0 opacity-0 transition-opacity group-hover:opacity-100">
                          <button
                            type="button"
                            className="rounded p-1 text-[var(--fg-subtle)] hover:bg-[var(--surface)] hover:text-[var(--fg)]"
                            onClick={() => startEdit(s)}
                            aria-label="Rename"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            className="rounded p-1 text-[var(--fg-subtle)] hover:bg-[var(--danger-soft)] hover:text-[var(--danger)]"
                            onClick={() => void onDelete(s.id)}
                            aria-label="Delete"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
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
