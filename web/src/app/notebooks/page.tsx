"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  BookOpen,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { LoadingOverlay } from "@/components/LoadingOverlay";
import { handleSubmitOnEnter } from "@/lib/keyboard";

type Notebook = {
  id: string;
  title: string;
  createdAt: string;
};

export default function NotebooksPage() {
  const router = useRouter();
  const [items, setItems] = useState<Notebook[]>([]);
  const [title, setTitle] = useState("");
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/notebooks", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) {
        const hint =
          typeof data.hint === "string" && data.hint ? ` ${data.hint}` : "";
        throw new Error(
          `${data.error || `Load failed (${res.status})`}${hint}`,
        );
      }
      setItems(Array.isArray(data.items) ? data.items : []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load notebooks");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    const clean = title.trim();
    if (!clean) {
      setError("Nhập tiêu đề notebook trước khi tạo.");
      return;
    }
    if (creating) return;

    setCreating(true);
    setError(null);
    setInfo(null);

    // Optimistic placeholder
    const tempId = `temp-${Date.now()}`;
    const optimistic: Notebook = {
      id: tempId,
      title: clean,
      createdAt: new Date().toISOString(),
    };
    setItems((prev) => [optimistic, ...prev]);

    try {
      const res = await fetch("/api/notebooks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: clean }),
        cache: "no-store",
      });

      let data: Record<string, unknown> = {};
      try {
        data = await res.json();
      } catch {
        data = {};
      }

      if (!res.ok) {
        setItems((prev) => prev.filter((n) => n.id !== tempId));
        const hint =
          typeof data.hint === "string" && data.hint ? ` ${data.hint}` : "";
        throw new Error(
          `${(data.error as string) || `Create failed (HTTP ${res.status}).`}${hint}`,
        );
      }

      if (!data.id || typeof data.id !== "string") {
        setItems((prev) => prev.filter((n) => n.id !== tempId));
        throw new Error("Server did not return notebook id.");
      }

      const created: Notebook = {
        id: data.id,
        title: String(data.title || clean),
        createdAt: String(data.createdAt || new Date().toISOString()),
      };

      setItems((prev) => [created, ...prev.filter((n) => n.id !== tempId)]);
      setTitle("");
      setInfo(`Đã tạo “${created.title}”. Đang mở…`);
      router.push(`/notebooks/${created.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed");
    } finally {
      setCreating(false);
    }
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void create();
  };

  const remove = async (id: string, name: string) => {
    if (!confirm(`Xóa notebook “${name}”?`)) return;
    setError(null);
    // optimistic remove
    const prev = items;
    setItems((list) => list.filter((n) => n.id !== id));
    try {
      const res = await fetch(`/api/notebooks/${id}`, { method: "DELETE" });
      if (!res.ok) {
        setItems(prev);
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error || "Delete failed");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    }
  };

  return (
    <AppShell>
      <LoadingOverlay
        show={creating || loading}
        label={creating ? "Creating notebook…" : "Loading notebooks…"}
      />
      <section className="glass-hero mb-8 p-6 sm:p-8">
        <div className="relative z-[1] grid gap-6 lg:grid-cols-[1.2fr_1fr] lg:items-end">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-teal-300/20 bg-teal-500/10 px-3 py-1 text-xs font-medium text-teal-100">
              <BookOpen className="h-3.5 w-3.5" aria-hidden />
              Private document Q&A
            </div>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              Notebooks
            </h1>
            <p className="mt-2 max-w-xl text-sm text-[var(--fg-muted)] sm:text-base">
              Tạo workspace, upload PDF/TXT/MD, hỏi với BM25 + citation. Nhấn{" "}
              <span className="kbd">Enter</span> để tạo nhanh.
            </p>
          </div>

          <form onSubmit={onSubmit} className="space-y-3">
            <label className="block text-xs font-medium text-[var(--fg-muted)]" htmlFor="nb-title">
              Tên notebook mới
            </label>
            <input
              id="nb-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) =>
                handleSubmitOnEnter(e, () => void create(), {
                  allowShiftNewline: false,
                })
              }
              placeholder="VD: Báo cáo AI 2026"
              className="field text-base"
              disabled={creating}
              maxLength={200}
              autoComplete="off"
            />
            <div className="flex flex-wrap gap-2">
              <button
                type="submit"
                disabled={creating || !title.trim()}
                className="btn-primary flex-1 sm:flex-none"
              >
                {creating ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <Plus className="h-4 w-4" aria-hidden />
                )}
                Create notebook
              </button>
              <button
                type="button"
                className="btn-ghost"
                onClick={() => void load()}
                disabled={loading}
              >
                <RefreshCw
                  className={`h-4 w-4 ${loading ? "animate-spin" : ""}`}
                  aria-hidden
                />
                Refresh
              </button>
            </div>
          </form>
        </div>
      </section>

      {error && (
        <div
          role="alert"
          className="mb-4 flex items-start gap-2 rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <div className="font-medium">Không tạo / tải được notebook</div>
            <div className="mt-0.5 opacity-90">{error}</div>
          </div>
        </div>
      )}

      {info && (
        <div
          role="status"
          className="mb-4 rounded-2xl border border-emerald-400/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100"
        >
          {info}
        </div>
      )}

      {loading && !items.length ? (
        <div className="flex items-center gap-2 text-sm text-[var(--fg-muted)]">
          <Loader2 className="h-4 w-4 animate-spin" /> Đang tải notebooks…
        </div>
      ) : items.length === 0 ? (
        <div className="glass p-12 text-center">
          <BookOpen className="mx-auto mb-3 h-10 w-10 text-indigo-300/80" aria-hidden />
          <p className="text-base font-medium">Chưa có notebook nào</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-[var(--fg-muted)]">
            Gõ tên ở form phía trên rồi nhấn <span className="kbd">Enter</span>{" "}
            hoặc nút Create.
          </p>
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {items.map((n) => (
            <li
              key={n.id}
              className="glass group p-4 transition duration-200 hover:border-indigo-300/35 hover:shadow-[0_0_40px_rgba(99,102,241,0.12)]"
            >
              <div className="flex items-start justify-between gap-2">
                <Link
                  href={n.id.startsWith("temp-") ? "#" : `/notebooks/${n.id}`}
                  className="min-w-0 flex-1 cursor-pointer"
                  onClick={(e) => {
                    if (n.id.startsWith("temp-")) e.preventDefault();
                  }}
                >
                  <h2 className="truncate text-base font-medium group-hover:text-indigo-200">
                    {n.title}
                    {n.id.startsWith("temp-") && (
                      <span className="ml-2 text-xs text-[var(--fg-muted)]">
                        (saving…)
                      </span>
                    )}
                  </h2>
                  <p className="mt-1 text-xs text-[var(--fg-muted)]">
                    {new Date(n.createdAt).toLocaleString()}
                  </p>
                </Link>
                {!n.id.startsWith("temp-") && (
                  <button
                    type="button"
                    aria-label={`Delete ${n.title}`}
                    onClick={() => void remove(n.id, n.title)}
                    className="btn-ghost min-h-10 px-2 text-[var(--fg-muted)] hover:text-rose-300"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </AppShell>
  );
}
