"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { Bot, User } from "lucide-react";
import { Markdown } from "@/components/Markdown";
import { cn } from "@/lib/utils";
import type { ChatMessage } from "@/lib/hooks/use-search-chat";

export function ChatThread({
  messages,
  activeAssistantId,
  onSelectAssistant,
  empty,
}: {
  messages: ChatMessage[];
  activeAssistantId: string | null;
  onSelectAssistant: (id: string) => void;
  empty?: ReactNode;
}) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, messages[messages.length - 1]?.content]);

  if (messages.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-4">
        {empty}
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-6">
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        {messages.map((m) => {
          const isUser = m.role === "user";
          const active = !isUser && m.id === activeAssistantId;
          return (
            <div
              key={m.id}
              className={cn(
                "flex gap-3",
                isUser ? "justify-end" : "justify-start",
              )}
            >
              {!isUser && (
                <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-indigo-500/20 text-indigo-200 ring-1 ring-indigo-400/30">
                  <Bot className="h-4 w-4" aria-hidden />
                </div>
              )}
              <button
                type="button"
                disabled={isUser}
                onClick={() => {
                  if (!isUser) onSelectAssistant(m.id);
                }}
                className={cn(
                  "max-w-[min(100%,42rem)] rounded-2xl px-4 py-3 text-left text-sm transition",
                  isUser
                    ? "bg-gradient-to-b from-indigo-500/35 to-indigo-600/20 text-white ring-1 ring-indigo-300/30"
                    : "glass cursor-pointer hover:ring-1 hover:ring-indigo-300/25",
                  active && !isUser && "ring-1 ring-indigo-400/40",
                )}
              >
                {isUser ? (
                  <p className="whitespace-pre-wrap">{m.content}</p>
                ) : m.content ? (
                  <Markdown content={m.content} />
                ) : (
                  <p className="text-[var(--fg-muted)]">
                    {m.streaming ? "Thinking…" : "No answer yet."}
                  </p>
                )}
                {isUser &&
                  m.expandedQuery &&
                  m.expandedQuery !== m.content && (
                    <p className="mt-2 text-[11px] text-indigo-100/70">
                      Searched: {m.expandedQuery}
                    </p>
                  )}
                {!isUser && m.timing?.totalMs != null && (
                  <p className="mt-2 text-[11px] text-[var(--fg-muted)]">
                    {m.timing.totalMs}ms
                    {m.results?.length
                      ? ` · ${m.results.length} sources`
                      : ""}
                  </p>
                )}
              </button>
              {isUser && (
                <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white/10 text-white/80 ring-1 ring-white/15">
                  <User className="h-4 w-4" aria-hidden />
                </div>
              )}
            </div>
          );
        })}
        <div ref={endRef} />
      </div>
    </div>
  );
}
