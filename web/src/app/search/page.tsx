"use client";

import { useEffect, useState } from "react";
import {
  AlertCircle,
  Clock,
  CornerDownLeft,
  History,
  Loader2,
  Search,
  Sparkles,
  Trash2,
} from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { EvidenceList } from "@/components/EvidenceList";
import { Markdown } from "@/components/Markdown";
import { StepRail } from "@/components/StepRail";
import { useSsePipeline } from "@/lib/hooks/use-sse";
import { handleSubmitOnEnter } from "@/lib/keyboard";

type HistoryItem = {
  id: string;
  query: string;
  status: string;
  createdAt: string;
  hasAnswer: boolean;
};

const SUGGESTIONS = [
  "What is TypeScript and why use it?",
  "So sánh BM25 và dense retrieval",
  "How does Supabase Auth work?",
  "Next.js App Router best practices 2026",
];

export default function SearchPage() {
  const [query, setQuery] = useState("");
  const [searchLimit, setSearchLimit] = useState(6);
  const [contextTopK, setContextTopK] = useState(4);
  const [generateAnswer, setGenerateAnswer] = useState(true);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [activeCitation, setActiveCitation] = useState<number | null>(null);
  const { state, run, cancel, hydrate } = useSsePipeline();

  const hasResult =
    state.status === "running" ||
    state.status === "completed" ||
    state.status === "failed" ||
    Boolean(state.answer || state.results.length);

  const loadHistory = async () => {
    try {
      const res = await fetch("/api/web-search/history");
      const data = await res.json();
      setHistory(data.items || []);
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    void loadHistory();
  }, [state.status]);

  const submit = async () => {
    if (!query.trim() || state.status === "running") return;
    await run("/api/web-search", {
      query: query.trim(),
      searchLimit,
      contextTopK,
      generateAnswer,
      enrichThinPages: false,
    });
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await submit();
  };

  const openHistory = async (id: string) => {
    const res = await fetch(`/api/web-search/${id}`);
    if (!res.ok) return;
    const data = await res.json();
    setQuery(data.query || "");
    hydrate({
      answer: data.answer,
      results: data.results,
      timing: data.timing,
      metrics: data.metrics,
    });
  };

  const deleteHistory = async (id: string) => {
    await fetch(`/api/web-search/history?id=${id}`, { method: "DELETE" });
    await loadHistory();
  };

  return (
    <AppShell wide bare>
      <div
        className={
          hasResult
            ? "grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]"
            : "mx-auto max-w-3xl"
        }
      >
        <div className="space-y-6">
          <section
            className={
              hasResult
                ? "glass-hero p-5 sm:p-6"
                : "glass-hero px-5 py-10 sm:px-10 sm:py-14"
            }
          >
            <div className="relative z-[1]">
              {!hasResult && (
                <div className="mb-6 text-center">
                  <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-indigo-300/25 bg-indigo-500/10 px-3 py-1 text-xs font-medium text-indigo-100">
                    <Sparkles className="h-3.5 w-3.5" aria-hidden />
                    Serverless AI research
                  </div>
                  <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
                    Ask the web anything
                  </h1>
                  <p className="mx-auto mt-3 max-w-lg text-sm text-[var(--fg-muted)] sm:text-base">
                    Search → retrieve → cite. Powered by Tavily, BM25, and Groq —
                    no Docker, no GPU.
                  </p>
                </div>
              )}

              {hasResult && (
                <div className="mb-3">
                  <h1 className="text-lg font-semibold tracking-tight sm:text-xl">
                    Web Search
                  </h1>
                </div>
              )}

              <form onSubmit={onSubmit} className="space-y-3">
                <label className="sr-only" htmlFor="web-query">
                  Search query
                </label>
                <div className="relative">
                  <Search
                    className="pointer-events-none absolute left-4 top-4 h-5 w-5 text-indigo-200/70"
                    aria-hidden
                  />
                  <textarea
                    id="web-query"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) =>
                      handleSubmitOnEnter(e, () => void submit(), {
                        allowShiftNewline: true,
                      })
                    }
                    rows={hasResult ? 2 : 3}
                    placeholder="What do you want to research?"
                    className="field min-h-[88px] resize-none py-3.5 pl-12 pr-4 text-base shadow-[0_0_0_1px_rgba(129,140,248,0.12)]"
                  />
                </div>

                <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--fg-muted)]">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="kbd">Enter</span> search
                    <span className="mx-1 opacity-40">·</span>
                    <span className="kbd">Shift</span>+
                    <span className="kbd">Enter</span> newline
                  </span>
                  <label className="inline-flex items-center gap-1.5">
                    Results
                    <input
                      type="number"
                      min={1}
                      max={12}
                      value={searchLimit}
                      onChange={(e) => setSearchLimit(Number(e.target.value))}
                      className="field w-14 min-h-9 px-2 py-1 text-center"
                    />
                  </label>
                  <label className="inline-flex items-center gap-1.5">
                    Context
                    <input
                      type="number"
                      min={1}
                      max={5}
                      value={contextTopK}
                      onChange={(e) => setContextTopK(Number(e.target.value))}
                      className="field w-14 min-h-9 px-2 py-1 text-center"
                    />
                  </label>
                  <label className="inline-flex min-h-11 cursor-pointer items-center gap-2">
                    <input
                      type="checkbox"
                      checked={generateAnswer}
                      onChange={(e) => setGenerateAnswer(e.target.checked)}
                      className="h-4 w-4 accent-indigo-500"
                    />
                    Generate answer
                  </label>
                  <div className="ml-auto flex gap-2">
                    {state.status === "running" && (
                      <button type="button" onClick={cancel} className="btn-ghost">
                        Cancel
                      </button>
                    )}
                    <button
                      type="submit"
                      disabled={state.status === "running" || !query.trim()}
                      className="btn-primary"
                    >
                      {state.status === "running" ? (
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                      ) : (
                        <CornerDownLeft className="h-4 w-4" aria-hidden />
                      )}
                      Search
                    </button>
                  </div>
                </div>
              </form>

              {!hasResult && (
                <div className="mt-6 flex flex-wrap justify-center gap-2">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      className="chip"
                      onClick={() => {
                        setQuery(s);
                      }}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </section>

          {hasResult && (
            <>
              <StepRail steps={state.steps} />

              {state.error && (
                <div
                  role="alert"
                  className="flex items-start gap-2 rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100"
                >
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{state.error}</span>
                </div>
              )}

              <div className="grid gap-4 lg:grid-cols-2">
                <section className="glass p-4 sm:p-5">
                  <div className="mb-3 flex items-center justify-between">
                    <h2 className="text-sm font-semibold">Answer</h2>
                    {state.timing?.totalMs != null && (
                      <span className="inline-flex items-center gap-1 text-xs text-[var(--fg-muted)]">
                        <Clock className="h-3.5 w-3.5" aria-hidden />
                        {state.timing.totalMs}ms
                      </span>
                    )}
                  </div>
                  {state.answer ? (
                    <Markdown content={state.answer} />
                  ) : (
                    <p className="text-sm text-[var(--fg-muted)]">
                      {state.status === "running"
                        ? "Streaming answer…"
                        : "Answer with citations will appear here."}
                    </p>
                  )}
                  {state.metrics && (
                    <div className="mt-4 flex flex-wrap gap-2 text-[11px] text-[var(--fg-muted)]">
                      <span className="rounded-md bg-white/5 px-2 py-0.5">
                        hits {state.metrics.resultCount ?? 0}
                      </span>
                      <span className="rounded-md bg-white/5 px-2 py-0.5">
                        chunks {state.metrics.chunkCount ?? 0}
                      </span>
                      <span className="rounded-md bg-white/5 px-2 py-0.5">
                        context {state.metrics.contextCount ?? 0}
                      </span>
                      <span className="rounded-md bg-white/5 px-2 py-0.5">
                        llm {state.metrics.llmUsed ? "on" : "off"}
                      </span>
                    </div>
                  )}
                </section>

                <section className="glass p-4 sm:p-5">
                  <h2 className="mb-3 text-sm font-semibold">Evidence</h2>
                  <EvidenceList
                    results={state.results}
                    activeId={activeCitation}
                    onHover={setActiveCitation}
                  />
                </section>
              </div>

              {state.logs.length > 0 && (
                <details className="glass p-4 text-xs text-[var(--fg-muted)]">
                  <summary className="cursor-pointer hover:text-[var(--fg)]">
                    Pipeline log
                  </summary>
                  <ul className="mt-2 space-y-1 font-mono">
                    {state.logs.map((l, i) => (
                      <li key={i}>{l}</li>
                    ))}
                  </ul>
                </details>
              )}
            </>
          )}
        </div>

        {hasResult && (
          <aside className="space-y-3">
            <div className="glass p-3">
              <div className="mb-2 flex items-center justify-between px-1">
                <span className="inline-flex items-center gap-2 text-sm font-medium">
                  <History className="h-4 w-4 text-indigo-300" aria-hidden />
                  History
                </span>
                <span className="text-xs text-[var(--fg-muted)]">
                  {history.length}
                </span>
              </div>
              <ul className="max-h-[70vh] space-y-2 overflow-auto pr-1">
                {history.map((h) => (
                  <li
                    key={h.id}
                    className="group rounded-xl border border-white/8 bg-black/20 p-2.5 transition hover:border-indigo-400/30"
                  >
                    <button
                      type="button"
                      onClick={() => void openHistory(h.id)}
                      className="w-full cursor-pointer text-left text-sm text-[var(--fg)] hover:text-indigo-200"
                    >
                      {h.query}
                    </button>
                    <div className="mt-1 flex items-center justify-between text-[10px] text-[var(--fg-muted)]">
                      <span>{new Date(h.createdAt).toLocaleString()}</span>
                      <button
                        type="button"
                        aria-label="Delete history item"
                        onClick={() => void deleteHistory(h.id)}
                        className="btn-ghost min-h-8 px-2 py-1 opacity-70 group-hover:opacity-100"
                      >
                        <Trash2 className="h-3.5 w-3.5 text-rose-300" />
                      </button>
                    </div>
                  </li>
                ))}
                {!history.length && (
                  <li className="px-1 py-6 text-center text-xs text-[var(--fg-muted)]">
                    No runs yet.
                  </li>
                )}
              </ul>
            </div>
          </aside>
        )}
      </div>
    </AppShell>
  );
}
