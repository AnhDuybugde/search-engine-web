"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  Menu,
  PanelRight,
  Sparkles,
  X,
} from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { EvidenceList } from "@/components/EvidenceList";
import { StepRail } from "@/components/StepRail";
import { ChatComposer } from "@/components/search/ChatComposer";
import { ChatThread } from "@/components/search/ChatThread";
import { SearchSidebar } from "@/components/search/SearchSidebar";
import {
  useSearchChat,
  useSearchSessions,
} from "@/lib/hooks/use-search-chat";
import { cn } from "@/lib/utils";

const SUGGESTIONS = [
  "Who is Lionel Messi?",
  "What is TypeScript and why use it?",
  "Compare BM25 and dense retrieval",
  "How does Supabase Auth work?",
];

export function SearchChatLayout({
  sessionId,
}: {
  sessionId: string | null;
}) {
  const router = useRouter();
  const {
    sessions,
    loading: sessionsLoading,
    error: sessionsError,
    create,
    rename,
    remove,
    refresh,
  } = useSearchSessions();

  const chat = useSearchChat(sessionId);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [evidenceOpen, setEvidenceOpen] = useState(true);
  const [activeCitation, setActiveCitation] = useState<number | null>(null);
  const [uiError, setUiError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (chat.status === "idle") void refresh();
  }, [chat.status, refresh]);

  const goSession = useCallback(
    (id: string | null) => {
      setSidebarOpen(false);
      if (!id) router.push("/search");
      else router.push(`/search/${id}`);
    },
    [router],
  );

  const onNew = async () => {
    setUiError(null);
    setCreating(true);
    try {
      const s = await create();
      goSession(s.id);
    } catch (err) {
      setUiError(
        err instanceof Error
          ? err.message
          : "Could not create chat session. Run npm run db:init if tables are missing.",
      );
    } finally {
      setCreating(false);
    }
  };

  const ensureSessionAndSend = async (
    query: string,
    opts: {
      searchLimit: number;
      contextTopK: number;
      generateAnswer: boolean;
    },
  ) => {
    setUiError(null);
    try {
      let id = sessionId;
      if (!id) {
        setCreating(true);
        try {
          const s = await create();
          id = s.id as string;
        } finally {
          setCreating(false);
        }
        // Queue message then navigate so the session page owns the stream
        sessionStorage.setItem(
          "pendingSearch",
          JSON.stringify({ id, query, opts }),
        );
        router.push(`/search/${id}`);
        return;
      }
      await chat.send(query, opts);
      await refresh();
    } catch (err) {
      setUiError(
        err instanceof Error
          ? err.message
          : "Failed to send message. Check search API keys and DB tables.",
      );
    }
  };

  // Consume pending first message after session mount (create on /search → navigate).
  // Defer slightly so this runs after the chat hook attaches sessionId, without
  // racing an abort-on-mount (see useSearchChat session effect).
  useEffect(() => {
    if (!sessionId) return;
    const raw = sessionStorage.getItem("pendingSearch");
    if (!raw) return;

    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (cancelled) return;
      try {
        const pending = JSON.parse(raw) as {
          id: string;
          query: string;
          opts: {
            searchLimit: number;
            contextTopK: number;
            generateAnswer: boolean;
          };
        };
        if (pending.id !== sessionId) return;
        sessionStorage.removeItem("pendingSearch");
        void chat
          .send(pending.query, pending.opts)
          .then(() => refresh())
          .catch((err: unknown) => {
            setUiError(
              err instanceof Error
                ? err.message
                : "Failed to send first message",
            );
          });
      } catch {
        sessionStorage.removeItem("pendingSearch");
      }
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fire once per session mount
  }, [sessionId]);

  const hasMessages = chat.messages.length > 0;
  const showEvidence =
    evidenceOpen &&
    (chat.activeEvidence.length > 0 || chat.status === "running");

  const bannerError = uiError || chat.error || sessionsError;

  return (
    <AppShell fill>
      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        {/* Mobile sidebar drawer */}
        {sidebarOpen && (
          <button
            type="button"
            className="absolute inset-0 z-30 bg-black/55 lg:hidden"
            aria-label="Close sidebar"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        <SearchSidebar
          sessions={sessions}
          currentId={sessionId}
          loading={sessionsLoading}
          onNew={() => void onNew()}
          onSelect={goSession}
          onRename={rename}
          onDelete={async (id) => {
            try {
              await remove(id);
              if (id === sessionId) goSession(null);
            } catch (err) {
              setUiError(
                err instanceof Error ? err.message : "Delete session failed",
              );
            }
          }}
          className={cn(
            "absolute inset-y-0 left-0 z-40 w-[var(--sidebar-w)] transition-transform duration-200 lg:static lg:translate-x-0",
            sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0",
            !sidebarOpen && "pointer-events-none lg:pointer-events-auto",
          )}
        />

        <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-[var(--bg-base)]">
          <div className="chat-toolbar">
            <button
              type="button"
              className="btn-ghost !min-h-8 !rounded-lg lg:hidden"
              onClick={() => setSidebarOpen(true)}
              aria-label="Open chat list"
            >
              <Menu className="h-4 w-4" />
            </button>
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-sm font-semibold tracking-tight">
                {sessionId ? chat.sessionTitle : "Web Search"}
              </h1>
              {chat.lastExpanded?.usedContext && (
                <p className="truncate text-[11px] text-[var(--fg-subtle)]">
                  Context: “{chat.lastExpanded.expanded}”
                </p>
              )}
            </div>
            <button
              type="button"
              className={cn(
                "btn-ghost !min-h-8 !rounded-lg",
                showEvidence &&
                  "bg-[var(--primary-soft)] text-[var(--fg)] ring-1 ring-[var(--primary-border)]",
              )}
              title="Toggle evidence"
              onClick={() => setEvidenceOpen((v) => !v)}
            >
              <PanelRight className="h-4 w-4" />
              <span className="hidden sm:inline">Evidence</span>
            </button>
          </div>

          {bannerError && (
            <div
              role="alert"
              className={cn(
                "alert mx-3 mt-2 shrink-0 sm:mx-4",
                /token|context length|maximum context/i.test(bannerError)
                  ? "alert-warn"
                  : "alert-error",
              )}
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span className="min-w-0 flex-1 break-words line-clamp-3">
                {bannerError}
              </span>
              <button
                type="button"
                className="ml-1 shrink-0 rounded-md p-1 hover:bg-black/5"
                aria-label="Dismiss error"
                onClick={() => setUiError(null)}
              >
                <X className="h-4 w-4 opacity-60" />
              </button>
            </div>
          )}

          {(chat.status === "running" ||
            Object.values(chat.steps || {}).some(
              (s) => s === "success" || s === "failed" || s === "running",
            )) && <StepRail steps={chat.steps} />}

          <ChatThread
            messages={chat.messages}
            activeAssistantId={chat.activeAssistantId}
            onSelectAssistant={chat.setActiveAssistantId}
            empty={
              <div className="chat-empty">
                <div className="chat-empty-badge">
                  <Sparkles className="h-3 w-3 text-[var(--primary)]" aria-hidden />
                  Session-aware research
                </div>
                <h2 className="chat-empty-title">Ask the web anything</h2>
                <p className="chat-empty-copy">
                  Multi-turn chat remembers entities in this session — e.g. ask
                  “Who is Lionel Messi?” then “How old is he?”.
                </p>
                <div className="chat-empty-actions">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      className="chip"
                      disabled={creating || chat.status === "running"}
                      onClick={() =>
                        void ensureSessionAndSend(s, {
                          searchLimit: 6,
                          contextTopK: 4,
                          generateAnswer: true,
                        })
                      }
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            }
          />

          <ChatComposer
            running={chat.status === "running" || creating}
            disabled={false}
            onCancel={chat.cancel}
            onSend={(q, opts) => void ensureSessionAndSend(q, opts)}
          />
        </div>

        {/* Desktop evidence column — secondary, does not fight chat */}
        {showEvidence && (
          <aside className="chat-panel hidden w-[var(--evidence-w)] shrink-0 xl:flex">
            <div className="chat-toolbar !border-l-0 text-sm font-semibold">
              Evidence
              {chat.activeEvidence.length > 0 && (
                <span className="ml-2 rounded-md bg-[var(--primary-soft)] px-1.5 py-0.5 text-[11px] font-medium text-[var(--primary)] ring-1 ring-[var(--primary-border)]">
                  {chat.activeEvidence.length}
                </span>
              )}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              <EvidenceList
                results={chat.activeEvidence}
                activeId={activeCitation}
                onHover={setActiveCitation}
              />
              {!chat.activeEvidence.length && (
                <p className="text-xs leading-relaxed text-[var(--fg-muted)]">
                  Sources for the selected answer will appear here.
                </p>
              )}
            </div>
            {chat.logs.length > 0 && (
              <details className="shrink-0 border-t border-[var(--border)] p-3 text-[11px] text-[var(--fg-muted)]">
                <summary className="cursor-pointer font-medium hover:text-[var(--fg)]">
                  Pipeline log
                </summary>
                <ul className="mt-2 max-h-36 space-y-1 overflow-y-auto font-mono text-[10px] text-[var(--fg-subtle)]">
                  {chat.logs.map((l, i) => (
                    <li key={i}>{l}</li>
                  ))}
                </ul>
              </details>
            )}
          </aside>
        )}
      </div>

      {/* Mobile / tablet evidence sheet */}
      {hasMessages && chat.activeEvidence.length > 0 && (
        <details className="shrink-0 border-t border-[var(--border)] bg-[var(--bg-panel)] p-3 xl:hidden">
          <summary className="cursor-pointer text-sm font-semibold">
            Evidence ({chat.activeEvidence.length})
          </summary>
          <div className="mt-3 max-h-48 overflow-y-auto">
            <EvidenceList
              results={chat.activeEvidence}
              activeId={activeCitation}
              onHover={setActiveCitation}
            />
          </div>
        </details>
      )}
    </AppShell>
  );
}
