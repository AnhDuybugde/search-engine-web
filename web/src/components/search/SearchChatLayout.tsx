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
    create,
    rename,
    remove,
    refresh,
  } = useSearchSessions();

  const chat = useSearchChat(sessionId);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [evidenceOpen, setEvidenceOpen] = useState(true);
  const [activeCitation, setActiveCitation] = useState<number | null>(null);

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
    const s = await create();
    goSession(s.id);
  };

  const ensureSessionAndSend = async (
    query: string,
    opts: {
      searchLimit: number;
      contextTopK: number;
      generateAnswer: boolean;
    },
  ) => {
    let id = sessionId;
    if (!id) {
      const s = await create();
      id = s.id;
      router.push(`/search/${id}`);
      // Wait a tick for sessionId prop to update via navigation
      await new Promise((r) => setTimeout(r, 50));
    }
    // If we just created, useSearchChat may still have null until navigation.
    // Call API path via temporary: push then send after load — better: send with id directly.
    if (id !== sessionId) {
      // Navigate first; user will send again — avoid race. Instead fire fetch with new id.
      await sendToSession(id!, query, opts);
      await refresh();
      return;
    }
    await chat.send(query, opts);
    await refresh();
  };

  const sendToSession = async (
    id: string,
    query: string,
    opts: {
      searchLimit: number;
      contextTopK: number;
      generateAnswer: boolean;
    },
  ) => {
    // Soft path when session just created: full page will hydrate; for UX stream on current chat state
    // by navigating and relying on chat.send after sessionId updates is racy.
    // Use router then trigger send via session-bound chat after short delay is fragile.
    // Simplest reliable: navigate with query in sessionStorage.
    sessionStorage.setItem(
      "pendingSearch",
      JSON.stringify({ id, query, opts }),
    );
    router.push(`/search/${id}`);
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
      void chat.send(pending.query, pending.opts).then(() => refresh());
    } catch {
      sessionStorage.removeItem("pendingSearch");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on sessionId mount
  }, [sessionId]);

  const hasMessages = chat.messages.length > 0;
  const showEvidence =
    evidenceOpen &&
    (chat.activeEvidence.length > 0 || chat.status === "running");

  return (
    <AppShell wide bare>
      <div className="relative -mx-4 -my-6 flex h-[calc(100dvh-4.5rem)] min-h-[480px] overflow-hidden border-t border-white/5 sm:-mx-6 sm:-my-10">
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
            await remove(id);
            if (id === sessionId) goSession(null);
          }}
          className={cn(
            "absolute inset-y-0 left-0 z-40 w-[260px] transition-transform lg:static lg:translate-x-0",
            sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0",
          )}
        />

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2 sm:px-4">
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

          {chat.error && (
            <div
              role="alert"
              className="mx-3 mt-2 flex items-start gap-2 rounded-xl border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-100 sm:mx-4"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{chat.error}</span>
              <button
                type="button"
                className="ml-auto"
                onClick={() => {/* error clears on next send */}}
              >
                <X className="h-4 w-4 opacity-60" />
              </button>
            </div>
          )}

          {chat.status === "running" && (
            <div className="px-3 pt-2 sm:px-4">
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
            running={chat.status === "running"}
            disabled={chat.loading}
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
        <details className="mx-4 mb-4 rounded-2xl border border-white/10 bg-black/20 p-3 xl:hidden">
          <summary className="cursor-pointer text-sm font-semibold">
            Evidence ({chat.activeEvidence.length})
          </summary>
          <div className="mt-3">
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
