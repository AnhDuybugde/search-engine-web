"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  BookOpen,
  FileText,
  Menu,
  PanelLeft,
  PanelRight,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { DatasetComposer } from "@/components/dataset/DatasetComposer";
import { DatasetSidebar, type DatasetSummary } from "@/components/dataset/DatasetSidebar";
import { DocumentDetailDrawer } from "@/components/dataset/DocumentDetailDrawer";
import { DocumentResultsList } from "@/components/dataset/DocumentResultsList";
import { ProcessExplainPanel } from "@/components/dataset/ProcessExplainPanel";
import { RunMetricsStrip } from "@/components/dataset/RunMetricsStrip";
import { UploadPipelinePanel } from "@/components/dataset/UploadPipelinePanel";
import { LoadingOverlay } from "@/components/LoadingOverlay";
import { ResizeHandle } from "@/components/ResizeHandle";
import { ChatThread } from "@/components/search/ChatThread";
import { PipelineInspector } from "@/components/pipeline/PipelineInspector";
import { StepRail } from "@/components/StepRail";
import type { ChatMessage } from "@/lib/hooks/use-search-chat";
import { usePanelLayout } from "@/lib/hooks/use-panel-layout";
import { useSsePipeline } from "@/lib/hooks/use-sse";
import { useUploadSse } from "@/lib/hooks/use-upload-sse";
import type { RankedDocument } from "@/lib/ir/types";
import { cn } from "@/lib/utils";

type Source = {
  id: string;
  title: string;
  mime: string | null;
  charCount: number;
  createdAt: string;
};

const SUGGESTIONS = [
  "Summarize the main points in this corpus",
  "Compare BM25 and dense retrieval in the documents",
  "What are the key concepts?",
];

export function DatasetChatLayout({
  notebookId,
}: {
  notebookId: string | null;
}) {
  const router = useRouter();
  const [datasets, setDatasets] = useState<DatasetSummary[]>([]);
  const [datasetsLoading, setDatasetsLoading] = useState(true);
  const [title, setTitle] = useState("");
  const [sources, setSources] = useState<Source[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [uiError, setUiError] = useState<string | null>(null);
  /** Mobile overlay for datasets list (narrow screens). */
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const panel = usePanelLayout({ storageKey: "dataset-chat" });
  const [rightTab, setRightTab] = useState<"sources" | "evidence" | "process">(
    "sources",
  );
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [activeAssistantId, setActiveAssistantId] = useState<string | null>(
    null,
  );
  const [selectedDoc, setSelectedDoc] = useState<RankedDocument | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [creating, setCreating] = useState(false);

  const { state, run, cancel, reset } = useSsePipeline();
  const uploadSse = useUploadSse();

  const loadDatasets = useCallback(async () => {
    setDatasetsLoading(true);
    try {
      const res = await fetch("/api/notebooks", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load datasets");
      const items = (Array.isArray(data.items) ? data.items : []).map(
        (n: { id: string; title: string; createdAt: string }) => ({
          id: n.id,
          title: n.title,
          createdAt: n.createdAt,
          updatedAt: n.createdAt,
        }),
      );
      setDatasets(items);
    } catch (err) {
      setUiError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setDatasetsLoading(false);
    }
  }, []);

  const loadNotebook = useCallback(async (id: string) => {
    setLoadError(null);
    try {
      const res = await fetch(`/api/notebooks/${id}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Notebook not found");
      setTitle(data.notebook?.title || "Dataset");
      setSources(data.sources || []);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load");
    }
  }, []);

  const loadChatHistory = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/notebooks/${id}/messages`, {
        cache: "no-store",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // Keep empty history if table not migrated yet
        setMessages([]);
        setActiveAssistantId(null);
        return;
      }
      const msgs: ChatMessage[] = (data.messages || []).map(
        (m: {
          id: string;
          role: "user" | "assistant";
          content: string;
          results?: ChatMessage["results"];
          timing?: ChatMessage["timing"];
          metrics?: ChatMessage["metrics"];
          status?: string;
          createdAt?: string;
        }) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          results: m.results || undefined,
          timing: m.timing || undefined,
          metrics: m.metrics || undefined,
          status: m.status,
          createdAt: m.createdAt,
        }),
      );
      setMessages(msgs);
      const lastAsst = [...msgs].reverse().find((m) => m.role === "assistant");
      setActiveAssistantId(lastAsst?.id ?? null);
    } catch {
      setMessages([]);
      setActiveAssistantId(null);
    }
  }, []);

  useEffect(() => {
    void loadDatasets();
  }, [loadDatasets]);

  useEffect(() => {
    reset();
    setMessages([]);
    setActiveAssistantId(null);
    setSelectedDoc(null);
    setDrawerOpen(false);
    setSources([]);
    setTitle("");
    if (notebookId) {
      void loadNotebook(notebookId);
      void loadChatHistory(notebookId);
    }
  }, [notebookId, loadNotebook, loadChatHistory, reset]);

  // Sync streaming answer into chat messages
  useEffect(() => {
    if (!activeAssistantId) return;
    if (state.status === "running" || state.status === "completed") {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === activeAssistantId
            ? {
                ...m,
                content: state.answer || m.content,
                streaming: state.status === "running",
                timing: state.timing,
                metrics: state.metrics,
                results: state.results,
              }
            : m,
        ),
      );
    }
  }, [
    state.answer,
    state.status,
    state.timing,
    state.metrics,
    state.results,
    activeAssistantId,
  ]);

  const goDataset = useCallback(
    (id: string | null) => {
      setMobileSidebarOpen(false);
      if (!id) router.push("/notebooks");
      else router.push(`/notebooks/${id}`);
    },
    [router],
  );

  const onNew = async () => {
    setUiError(null);
    setCreating(true);
    try {
      const name = `Dataset ${new Date().toLocaleString()}`;
      const res = await fetch("/api/notebooks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Create failed");
      await loadDatasets();
      goDataset(data.id as string);
    } catch (err) {
      setUiError(err instanceof Error ? err.message : "Create failed");
    } finally {
      setCreating(false);
    }
  };

  const onDelete = async (id: string, name: string) => {
    if (!confirm(`Delete dataset “${name}”?`)) return;
    try {
      const res = await fetch(`/api/notebooks/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error || "Delete failed");
      }
      await loadDatasets();
      if (notebookId === id) goDataset(null);
    } catch (err) {
      setUiError(err instanceof Error ? err.message : "Delete failed");
    }
  };

  const onUpload = async (file: File) => {
    if (!notebookId) {
      setUiError("Create or select a dataset first.");
      return;
    }
    setUiError(null);
    setRightTab("sources");
    try {
      await uploadSse.upload(`/api/notebooks/${notebookId}/upload`, file);
      await loadNotebook(notebookId);
      await loadDatasets();
    } catch (err) {
      setUiError(err instanceof Error ? err.message : "Upload failed");
    }
  };

  const onSend = async (query: string) => {
    if (!notebookId) {
      setUiError("Select a dataset first.");
      return;
    }
    if (!sources.length) {
      setUiError("Upload at least one document before chatting.");
      setRightTab("sources");
      return;
    }
    setUiError(null);
    setDrawerOpen(false);

    const userId = `u-${Date.now()}`;
    const asstId = `a-${Date.now()}`;
    setMessages((prev) => [
      ...prev,
      { id: userId, role: "user", content: query },
      {
        id: asstId,
        role: "assistant",
        content: "",
        streaming: true,
      },
    ]);
    setActiveAssistantId(asstId);
    setRightTab("evidence");

    await run(`/api/notebooks/${notebookId}/ask`, {
      query,
      generateAnswer: true,
      contextTopK: 4,
      documentTopK: 10,
      retrieveTopK: 40,
    });
  };

  // Query-time retrieval unit count only (upload always stores 0 chunks).
  const retrievalUnitCount =
    state.metrics?.chunkCount != null && state.metrics.chunkCount > 0
      ? state.metrics.chunkCount
      : undefined;
  const totalChars = sources.reduce((n, s) => n + (s.charCount || 0), 0);

  const notebookSteps = useMemo(
    () => ({
      corpus: sources.length > 0 ? ("success" as const) : ("pending" as const),
      query: state.steps.query || ("pending" as const),
      retrieve: state.steps.retrieve || ("pending" as const),
      embedding: state.steps.embedding || ("pending" as const),
      fusion: state.steps.fusion || ("pending" as const),
      generate: state.steps.generate || ("pending" as const),
    }),
    [sources.length, state.steps],
  );

  const uploading = uploadSse.state.status === "running";
  const running = state.status === "running";
  const {
    leftOpen,
    rightOpen,
    leftWidth,
    rightWidth,
    toggleLeft,
    toggleRight,
    openLeft,
    closeLeft,
    openRight,
    closeRight,
    beginResize,
  } = panel;

  return (
    <AppShell fill>
      <LoadingOverlay
        show={creating || uploading || running}
        label={
          creating
            ? "Creating dataset…"
            : uploading
              ? "Storing raw document…"
              : state.steps.generate === "running"
                ? "Generating answer…"
                : "Ranking documents…"
        }
      />

      <div className="flex min-h-0 flex-1">
        {/* Mobile datasets drawer backdrop */}
        {mobileSidebarOpen && (
          <button
            type="button"
            className="fixed inset-0 z-40 bg-slate-900/30 xl:hidden"
            aria-label="Close datasets"
            onClick={() => setMobileSidebarOpen(false)}
          />
        )}

        {/* Desktop collapsed rail — reopen datasets */}
        {!leftOpen && (
          <div className="panel-rail hidden xl:flex" aria-label="Datasets collapsed">
            <button
              type="button"
              className="panel-rail-btn"
              onClick={openLeft}
              aria-label="Expand datasets panel"
              title="Expand datasets"
            >
              <PanelLeft className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Datasets sidebar — resizable + collapsible on xl; drawer on mobile */}
        <div
          className={cn(
            "panel-shell z-50 bg-[var(--bg-elevated)]",
            "fixed inset-y-0 left-0 pt-14 transition-transform xl:static xl:pt-0",
            mobileSidebarOpen
              ? "translate-x-0"
              : "-translate-x-full xl:translate-x-0",
            !leftOpen && "is-collapsed",
          )}
          style={{ width: leftWidth }}
        >
          <DatasetSidebar
            items={datasets}
            currentId={notebookId}
            loading={datasetsLoading}
            onNew={() => void onNew()}
            onSelect={(id) => {
              goDataset(id);
              setMobileSidebarOpen(false);
            }}
            onDelete={(id, t) => void onDelete(id, t)}
            onCollapse={closeLeft}
            className="h-full border-0"
          />
          {leftOpen && (
            <div className="absolute inset-y-0 right-0 hidden xl:block">
              <ResizeHandle
                side="left"
                label="Resize datasets panel"
                onResizeStart={(e) => beginResize("left", e)}
              />
            </div>
          )}
        </div>

        {/* Main chat column */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-[var(--bg-base)]">
          <div className="chat-toolbar">
            <button
              type="button"
              className="btn-ghost !min-h-8 !rounded-lg !px-2 xl:hidden"
              onClick={() => setMobileSidebarOpen(true)}
              aria-label="Open datasets"
            >
              <Menu className="h-4 w-4" />
            </button>
            <button
              type="button"
              className={cn(
                "btn-ghost !min-h-8 !rounded-lg !px-2 hidden xl:inline-flex",
                leftOpen &&
                  "bg-[var(--primary-soft)] text-[var(--fg)] ring-1 ring-[var(--primary-border)]",
              )}
              onClick={toggleLeft}
              aria-label={leftOpen ? "Collapse datasets" : "Expand datasets"}
              aria-pressed={leftOpen}
              title={leftOpen ? "Collapse datasets" : "Expand datasets"}
            >
              <PanelLeft className="h-4 w-4" />
              <span className="hidden sm:inline">Datasets</span>
            </button>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold tracking-tight text-[var(--fg)]">
                {notebookId ? title || "Dataset chat" : "Dataset Search"}
              </div>
              {notebookId && (
                <div className="truncate text-[11px] text-[var(--fg-subtle)]">
                  {sources.length} raw source
                  {sources.length === 1 ? "" : "s"} · full-text search · no
                  pre-index
                </div>
              )}
            </div>
            {notebookId && (
              <button
                type="button"
                className={cn(
                  "btn-ghost !min-h-8 !rounded-lg !px-2",
                  rightOpen &&
                    "bg-[var(--primary-soft)] text-[var(--fg)] ring-1 ring-[var(--primary-border)]",
                )}
                onClick={toggleRight}
                aria-label={rightOpen ? "Collapse side panel" : "Expand side panel"}
                aria-pressed={rightOpen}
                title={rightOpen ? "Collapse panel" : "Expand panel"}
              >
                <PanelRight className="h-4 w-4" />
                <span className="hidden sm:inline">Panel</span>
              </button>
            )}
          </div>

          {(uiError || loadError || state.error || uploadSse.state.error) && (
            <div
              role="alert"
              className={cn(
                "alert m-3 shrink-0",
                /token|context length|maximum context/i.test(
                  uiError || loadError || state.error || uploadSse.state.error || "",
                )
                  ? "alert-warn"
                  : "alert-error",
              )}
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span className="min-w-0 flex-1 break-words line-clamp-3">
                {uiError || loadError || state.error || uploadSse.state.error}
              </span>
            </div>
          )}

          {(running ||
            Object.values(notebookSteps).some(
              (s) => s === "success" || s === "failed" || s === "running",
            )) &&
            notebookId && <StepRail steps={notebookSteps} />}

          <ChatThread
            messages={messages}
            activeAssistantId={activeAssistantId}
            onSelectAssistant={(id) => {
              setActiveAssistantId(id);
              setRightTab("evidence");
            }}
            empty={
              <div className="chat-empty">
                <div className="chat-empty-badge">
                  <Sparkles className="h-3 w-3 text-[var(--primary)]" />
                  Dataset chat
                </div>
                <h2 className="chat-empty-title">
                  {notebookId
                    ? sources.length
                      ? "Ask your documents"
                      : "Store a raw source to start"
                    : "Create or open a dataset"}
                </h2>
                <p className="chat-empty-copy">
                  {notebookId
                    ? sources.length
                      ? "Search runs over full source text at query time. Upload stores documents only — no chunk or embedding index."
                      : "Attach PDF/TXT/MD with the paperclip. We extract text and store the raw source only, then you can ask."
                    : "Sidebar datasets · message thread · composer — store raw sources, then chat."}
                </p>
                <div className="chat-empty-actions">
                  {!notebookId && (
                    <button
                      type="button"
                      onClick={() => void onNew()}
                      className="btn-primary"
                    >
                      <BookOpen className="h-4 w-4" />
                      New dataset
                    </button>
                  )}
                  {notebookId && sources.length > 0 &&
                    SUGGESTIONS.map((s) => (
                      <button
                        key={s}
                        type="button"
                        className="chip"
                        disabled={running}
                        onClick={() => void onSend(s)}
                      >
                        {s}
                      </button>
                    ))}
                  {notebookId && !sources.length && (
                    <label className="inline-flex cursor-pointer flex-col items-center gap-2 rounded-2xl border border-dashed border-[var(--border-strong)] bg-[var(--bg-elevated)] px-7 py-6 text-xs text-[var(--fg-muted)] shadow-sm transition hover:border-[var(--primary-border)] hover:bg-[var(--primary-soft)]">
                      <Upload className="h-5 w-5 text-[var(--primary)]" />
                      <span className="text-sm font-semibold text-[var(--fg)]">
                        Store first raw source
                      </span>
                      <span className="text-[var(--fg-subtle)]">
                        PDF · TXT · MD · CSV · no chunk/embed at upload
                      </span>
                      <input
                        type="file"
                        className="hidden"
                        accept=".pdf,.txt,.md,.markdown,.csv,.json,text/plain,application/pdf"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) void onUpload(f);
                        }}
                      />
                    </label>
                  )}
                </div>
              </div>
            }
          />

          <DatasetComposer
            disabled={!notebookId}
            running={running}
            uploading={uploading}
            onSend={(q) => void onSend(q)}
            onCancel={cancel}
            onUpload={notebookId ? (f) => void onUpload(f) : undefined}
            placeholder={
              !notebookId
                ? "Select or create a dataset to chat…"
                : !sources.length
                  ? "Store a raw source first (paperclip)…"
                  : "Ask about your stored sources…"
            }
          />
        </div>

        {/* Collapsed right rail — reopen Sources / Evidence / Process */}
        {notebookId && !rightOpen && (
          <div
            className="panel-rail panel-rail--right hidden xl:flex"
            aria-label="Side panel collapsed"
          >
            <button
              type="button"
              className="panel-rail-btn"
              onClick={openRight}
              aria-label="Expand side panel"
              title="Expand panel"
            >
              <PanelRight className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Right panel — sources / evidence / process (resizable + collapsible) */}
        {notebookId && (
          <aside
            className={cn(
              "chat-panel panel-shell relative hidden shrink-0 xl:flex",
              !rightOpen && "is-collapsed",
            )}
            style={{ width: rightWidth }}
            aria-hidden={!rightOpen}
          >
            {rightOpen && (
              <ResizeHandle
                side="right"
                label="Resize side panel"
                onResizeStart={(e) => beginResize("right", e)}
              />
            )}
            <div className="chat-panel-tabs">
              {(
                [
                  ["sources", "Sources"],
                  ["evidence", "Evidence"],
                  ["process", "Process"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setRightTab(id)}
                  className={cn(
                    "chat-panel-tab",
                    rightTab === id && "chat-panel-tab--active",
                  )}
                >
                  {label}
                </button>
              ))}
              <button
                type="button"
                className="ml-auto rounded-lg p-1.5 text-[var(--fg-subtle)] hover:bg-[var(--surface-hover)]"
                onClick={closeRight}
                aria-label="Collapse panel"
                title="Collapse panel"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              {rightTab === "sources" && (
                <div className="space-y-3">
                  <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-panel)] px-2.5 py-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--fg-subtle)]">
                      Corpus
                    </p>
                    <p className="mt-1 text-[12px] text-[var(--fg)]">
                      <strong>{sources.length}</strong> raw source
                      {sources.length === 1 ? "" : "s"}
                      {totalChars > 0 && (
                        <>
                          {" · "}
                          <span className="font-mono text-[11px] text-[var(--fg-muted)]">
                            {totalChars.toLocaleString()} chars
                          </span>
                        </>
                      )}
                    </p>
                    <p className="mt-0.5 text-[10px] leading-relaxed text-[var(--fg-subtle)]">
                      Durable store is full document text only. Chunking and
                      embedding are not written at upload; ranking builds
                      units at query time.
                    </p>
                  </div>
                  <UploadPipelinePanel state={uploadSse.state} />
                  <ul className="space-y-1.5">
                    {sources.map((s) => (
                      <li
                        key={s.id}
                        className="flex items-start gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2.5 text-xs"
                      >
                        <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--primary)]" />
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-medium text-[var(--fg)]">
                            {s.title}
                          </div>
                          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[var(--fg-subtle)]">
                            <span>{s.charCount.toLocaleString()} chars</span>
                            <span className="rounded border border-[var(--border)] bg-[var(--bg-elevated)] px-1 py-px font-mono text-[9px] uppercase tracking-wide">
                              raw
                            </span>
                          </div>
                        </div>
                      </li>
                    ))}
                    {!sources.length && (
                      <li className="py-2 text-xs text-[var(--fg-muted)]">
                        No sources yet — use the paperclip to store a raw
                        document.
                      </li>
                    )}
                  </ul>
                </div>
              )}
              {rightTab === "evidence" && (
                <div className="space-y-5">
                  <div>
                    <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[var(--fg-subtle)]">
                      Run overview
                    </h3>
                    <div className="mt-2">
                      <RunMetricsStrip
                        timing={state.timing}
                        metrics={state.metrics}
                      />
                    </div>
                  </div>
                  <div>
                    <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[var(--fg-subtle)]">
                      Top documents
                    </h3>
                    <p className="mt-0.5 mb-2 text-[11px] leading-relaxed text-[var(--fg-subtle)]">
                      Click a row for full source text and ranking breakdown.
                    </p>
                    <DocumentResultsList
                      documents={state.documents}
                      activeId={selectedDoc?.documentId}
                      onSelect={(doc) => {
                        setSelectedDoc(doc);
                        setDrawerOpen(true);
                      }}
                    />
                  </div>
                </div>
              )}
              {rightTab === "process" && (
                <div className="space-y-4">
                  <PipelineInspector
                    variant="notebook"
                    runStatus={state.status}
                    steps={state.steps}
                    timing={state.timing}
                    metrics={state.metrics}
                    results={state.results}
                    logs={state.logs}
                    chunkCount={retrievalUnitCount}
                    sourceCount={sources.length}
                  />
                  <ProcessExplainPanel
                    timing={state.timing}
                    metrics={state.metrics}
                    documents={state.documents}
                    rankedChunks={
                      state.rankedChunks.length
                        ? state.rankedChunks
                        : state.results
                    }
                    packedChunks={state.results}
                    onSelectDocument={(doc) => {
                      setSelectedDoc(doc);
                      setDrawerOpen(true);
                    }}
                  />
                </div>
              )}
            </div>
          </aside>
        )}
      </div>

      {notebookId && (
        <DocumentDetailDrawer
          notebookId={notebookId}
          document={selectedDoc}
          rankedChunks={
            state.rankedChunks.length ? state.rankedChunks : state.results
          }
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
        />
      )}
    </AppShell>
  );
}
