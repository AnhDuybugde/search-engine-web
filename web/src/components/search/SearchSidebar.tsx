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
    <aside
      className={cn(
        "flex h-full min-h-0 flex-col border-r border-white/10 bg-black/20",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2 border-b border-white/10 p-3">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <MessageSquare className="h-4 w-4 text-indigo-300" aria-hidden />
          Chats
        </div>
        <button
          type="button"
          onClick={onNew}
          className="btn-primary !min-h-9 !px-2.5 !py-1.5 text-xs"
          title="New chat"
        >
          <Plus className="h-4 w-4" aria-hidden />
          <span className="hidden sm:inline">New</span>
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {loading && sessions.length === 0 && (
          <div className="flex items-center justify-center gap-2 py-8 text-xs text-[var(--fg-muted)]">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading…
          </div>
        )}
        {!loading && sessions.length === 0 && (
          <p className="px-2 py-6 text-center text-xs text-[var(--fg-muted)]">
            No chats yet. Start a new search conversation.
          </p>
        )}
        <ul className="space-y-1">
          {sessions.map((s) => {
            const active = s.id === currentId;
            return (
              <li key={s.id}>
                <div
                  className={cn(
                    "group rounded-xl border px-2.5 py-2 transition",
                    active
                      ? "border-indigo-400/35 bg-indigo-500/15"
                      : "border-transparent hover:border-white/10 hover:bg-white/[0.04]",
                  )}
                >
                  {editingId === s.id ? (
                    <div className="flex items-center gap-1">
                      <input
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void saveEdit();
                          if (e.key === "Escape") setEditingId(null);
                        }}
                        className="field min-h-8 flex-1 px-2 py-1 text-xs"
                        autoFocus
                      />
                      <button
                        type="button"
                        className="btn-ghost !min-h-8 !px-2"
                        onClick={() => void saveEdit()}
                        disabled={busyId === s.id}
                      >
                        <Check className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        className="btn-ghost !min-h-8 !px-2"
                        onClick={() => setEditingId(null)}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="w-full text-left"
                      onClick={() => onSelect(s.id)}
                    >
                      <div className="truncate text-sm font-medium">
                        {s.title || "New chat"}
                      </div>
                      <div className="mt-0.5 text-[11px] text-[var(--fg-muted)]">
                        {relativeTime(s.updatedAt)}
                      </div>
                    </button>
                  )}
                  {editingId !== s.id && (
                    <div className="mt-1 flex justify-end gap-1 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
                      <button
                        type="button"
                        className="btn-ghost !min-h-7 !px-1.5 text-[var(--fg-muted)]"
                        title="Rename"
                        onClick={() => startEdit(s)}
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        className="btn-ghost !min-h-7 !px-1.5 text-rose-300/80"
                        title="Delete"
                        disabled={busyId === s.id}
                        onClick={async () => {
                          if (!confirm("Delete this chat?")) return;
                          setBusyId(s.id);
                          try {
                            await onDelete(s.id);
                          } finally {
                            setBusyId(null);
                          }
                        }}
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </aside>
  );
}
