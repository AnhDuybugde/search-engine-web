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
  "Messi là ai?",
  "What is TypeScript and why use it?",
  "So sánh BM25 và dense retrieval",
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

  // Consume pending first message after session mount
  useEffect(() => {
    if (!sessionId) return;
    const raw = sessionStorage.getItem("pendingSearch");
    if (!raw) return;
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
            err instanceof Error ? err.message : "Failed to send first message",
          );
        });
    } catch {
      sessionStorage.removeItem("pendingSearch");
    }
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
            className="absolute inset-0 z-30 bg-black/50 lg:hidden"
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
            "absolute inset-y-0 left-0 z-40 w-[260px] bg-[#070b14]/95 transition-transform lg:static lg:translate-x-0 lg:bg-black/20",
            sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0",
            !sidebarOpen && "pointer-events-none lg:pointer-events-auto",
          )}
        />

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex shrink-0 items-center gap-2 border-b border-white/10 px-3 py-2 sm:px-4">
            <button
              type="button"
              className="btn-ghost !min-h-9 lg:hidden"
              onClick={() => setSidebarOpen(true)}
            >
              <Menu className="h-4 w-4" />
            </button>
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-sm font-semibold sm:text-base">
                {sessionId ? chat.sessionTitle : "Web Search"}
              </h1>
              {chat.lastExpanded?.usedContext && (
                <p className="truncate text-[11px] text-indigo-200/75">
                  Context: searched “{chat.lastExpanded.expanded}”
                </p>
              )}
            </div>
            <button
              type="button"
              className={cn(
                "btn-ghost !min-h-9",
                showEvidence && "ring-1 ring-indigo-400/30",
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
              className="mx-3 mt-2 flex shrink-0 items-start gap-2 rounded-xl border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-100 sm:mx-4"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span className="min-w-0 break-words">{bannerError}</span>
              <button
                type="button"
                className="ml-auto shrink-0"
                aria-label="Dismiss error"
                onClick={() => setUiError(null)}
              >
                <X className="h-4 w-4 opacity-60" />
              </button>
            </div>
          )}

          {chat.status === "running" && (
            <div className="shrink-0 px-3 pt-2 sm:px-4">
              <StepRail steps={chat.steps} />
            </div>
          )}

          <ChatThread
            messages={chat.messages}
            activeAssistantId={chat.activeAssistantId}
            onSelectAssistant={chat.setActiveAssistantId}
            empty={
              <div className="w-full max-w-xl text-center">
                <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-indigo-300/25 bg-indigo-500/10 px-3 py-1 text-xs font-medium text-indigo-100">
                  <Sparkles className="h-3.5 w-3.5" aria-hidden />
                  Session-aware research
                </div>
                <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
                  Ask the web anything
                </h2>
                <p className="mx-auto mt-3 max-w-md text-sm text-[var(--fg-muted)]">
                  Multi-turn chat remembers entities in this session — e.g. ask
                  “Messi là ai?” then “ông ấy bao nhiêu tuổi?”.
                </p>
                <div className="mt-6 flex flex-wrap justify-center gap-2">
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

        {showEvidence && (
          <aside className="hidden w-[300px] shrink-0 flex-col border-l border-white/10 bg-black/15 xl:flex">
            <div className="border-b border-white/10 px-3 py-2.5 text-sm font-semibold">
              Evidence
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              <EvidenceList
                results={chat.activeEvidence}
                activeId={activeCitation}
                onHover={setActiveCitation}
              />
              {!chat.activeEvidence.length && (
                <p className="text-xs text-[var(--fg-muted)]">
                  Sources for the selected answer will appear here.
                </p>
              )}
            </div>
            {chat.logs.length > 0 && (
              <details className="border-t border-white/10 p-3 text-[11px] text-[var(--fg-muted)]">
                <summary className="cursor-pointer">Pipeline log</summary>
                <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto font-mono">
                  {chat.logs.map((l, i) => (
                    <li key={i}>{l}</li>
                  ))}
                </ul>
              </details>
            )}
          </aside>
        )}
      </div>

      {/* Mobile evidence sheet when messages exist */}
      {hasMessages && chat.activeEvidence.length > 0 && (
        <details className="shrink-0 border-t border-white/10 bg-black/20 p-3 xl:hidden">
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
