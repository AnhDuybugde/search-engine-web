"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  AlertCircle,
  ArrowLeft,
  CornerDownLeft,
  FileText,
  Loader2,
  Upload,
} from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { EvidenceList } from "@/components/EvidenceList";
import { LoadingOverlay } from "@/components/LoadingOverlay";
import { Markdown } from "@/components/Markdown";
import { StepRail } from "@/components/StepRail";
import { useSsePipeline } from "@/lib/hooks/use-sse";
import { handleSubmitOnEnter } from "@/lib/keyboard";

type Source = {
  id: string;
  title: string;
  mime: string | null;
  charCount: number;
  createdAt: string;
};

export default function NotebookDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [title, setTitle] = useState("");
  const [sources, setSources] = useState<Source[]>([]);
  const [query, setQuery] = useState("");
  const [uploading, setUploading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadOk, setUploadOk] = useState<string | null>(null);
  const { state, run, cancel } = useSsePipeline();

  const load = async () => {
    setLoadError(null);
    try {
      const res = await fetch(`/api/notebooks/${id}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Notebook not found");
      setTitle(data.notebook?.title || "Notebook");
      setSources(data.sources || []);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load");
    }
  };

  useEffect(() => {
    void load();
  }, [id]);

  const onUpload = async (file: File | null) => {
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    setUploadOk(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`/api/notebooks/${id}/upload`, {
        method: "POST",
        body: form,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");
      setUploadOk(
        `Uploaded “${data.title}” · ${data.chunkCount ?? "?"} chunks · ${
          data.charCount?.toLocaleString?.() ?? "?"
        } chars`,
      );
      await load();
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const ask = async () => {
    if (!query.trim() || state.status === "running") return;
    if (!sources.length) {
      setUploadError("Upload ít nhất 1 tài liệu (PDF/TXT/MD) trước khi hỏi.");
      return;
    }
    await run(`/api/notebooks/${id}/ask`, {
      query: query.trim(),
      generateAnswer: true,
      contextTopK: 4,
    });
  };

  const onAsk = async (e: React.FormEvent) => {
    e.preventDefault();
    await ask();
  };

  return (
    <AppShell wide>
      <LoadingOverlay
        show={uploading || state.status === "running"}
        label={
          uploading
            ? "Uploading & chunking…"
            : state.steps.generate === "running"
              ? "Generating answer…"
              : "Retrieving evidence…"
        }
      />
      <div className="mb-5">
        <Link
          href="/notebooks"
          className="inline-flex min-h-11 items-center gap-1.5 text-sm text-[var(--fg-muted)] transition hover:text-[var(--fg)]"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden /> All notebooks
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
          {title || "Notebook"}
        </h1>
      </div>

      {loadError && (
        <div
          role="alert"
          className="mb-4 flex gap-2 rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100"
        >
          <AlertCircle className="h-4 w-4 shrink-0" />
          {loadError}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
        <aside className="space-y-3">
          <div className="glass p-4">
            <h2 className="mb-3 text-sm font-semibold">Sources</h2>
            <label className="flex min-h-[130px] cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-indigo-300/25 bg-indigo-500/5 px-3 py-6 text-center text-xs text-[var(--fg-muted)] transition hover:border-indigo-300/50 hover:bg-indigo-500/10 hover:text-[var(--fg)]">
              {uploading ? (
                <Loader2 className="h-6 w-6 animate-spin text-indigo-300" />
              ) : (
                <Upload className="h-6 w-6 text-indigo-300" aria-hidden />
              )}
              <span className="text-sm font-medium text-[var(--fg)]">
                Drop or click to upload
              </span>
              <span>PDF · TXT · MD · CSV · max 5MB</span>
              <input
                type="file"
                accept=".pdf,.txt,.md,.markdown,.csv,.json,text/plain,application/pdf"
                className="hidden"
                disabled={uploading}
                onChange={(e) => void onUpload(e.target.files?.[0] || null)}
              />
            </label>
            {uploadError && (
              <p role="alert" className="mt-2 text-xs text-rose-300">
                {uploadError}
              </p>
            )}
            {uploadOk && (
              <p role="status" className="mt-2 text-xs text-emerald-300">
                {uploadOk}
              </p>
            )}
            <ul className="mt-3 space-y-2">
              {sources.map((s) => (
                <li
                  key={s.id}
                  className="flex items-start gap-2 rounded-xl border border-white/8 bg-black/20 p-2.5 text-xs"
                >
                  <FileText
                    className="mt-0.5 h-3.5 w-3.5 shrink-0 text-indigo-300"
                    aria-hidden
                  />
                  <div className="min-w-0">
                    <div className="truncate font-medium text-[var(--fg)]">
                      {s.title}
                    </div>
                    <div className="text-[var(--fg-muted)]">
                      {s.charCount.toLocaleString()} chars
                    </div>
                  </div>
                </li>
              ))}
              {!sources.length && (
                <li className="py-2 text-xs text-[var(--fg-muted)]">
                  Chưa có source — upload file để bật Ask.
                </li>
              )}
            </ul>
          </div>
        </aside>

        <div className="space-y-4">
          <form onSubmit={onAsk} className="glass-hero space-y-3 p-4 sm:p-5">
            <div className="relative z-[1] space-y-3">
              <label className="text-sm font-semibold" htmlFor="nb-ask">
                Ask this notebook
              </label>
              <textarea
                id="nb-ask"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) =>
                  handleSubmitOnEnter(e, () => void ask(), {
                    allowShiftNewline: true,
                  })
                }
                rows={3}
                placeholder="Hỏi về tài liệu đã upload…"
                className="field resize-none"
                disabled={!sources.length}
              />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs text-[var(--fg-muted)]">
                  <span className="kbd">Enter</span> ask ·{" "}
                  <span className="kbd">Shift</span>+
                  <span className="kbd">Enter</span> newline
                </span>
                <div className="flex gap-2">
                  {state.status === "running" && (
                    <button type="button" onClick={cancel} className="btn-ghost">
                      Cancel
                    </button>
                  )}
                  <button
                    type="submit"
                    disabled={
                      !query.trim() ||
                      state.status === "running" ||
                      !sources.length
                    }
                    className="btn-primary"
                  >
                    {state.status === "running" ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    ) : (
                      <CornerDownLeft className="h-4 w-4" aria-hidden />
                    )}
                    Ask
                  </button>
                </div>
              </div>
            </div>
          </form>

          <StepRail steps={state.steps} />

          {state.error && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              {state.error}
            </div>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            <section className="glass p-4 sm:p-5">
              <h2 className="mb-3 text-sm font-semibold">Answer</h2>
              {state.answer ? (
                <Markdown content={state.answer} />
              ) : (
                <p className="text-sm text-[var(--fg-muted)]">
                  Upload documents, then ask. Evidence + citations show here.
                </p>
              )}
            </section>
            <section className="glass p-4 sm:p-5">
              <h2 className="mb-3 text-sm font-semibold">Evidence</h2>
              <EvidenceList results={state.results} />
            </section>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
