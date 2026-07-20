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
  const lastMessageContent = messages[messages.length - 1]?.content;

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, lastMessageContent]);

  if (messages.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-4">
        {empty}
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-3 py-5 sm:px-6">
      <div className="mx-auto flex max-w-[var(--chat-max)] flex-col gap-5">
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
                <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[var(--primary-soft)] text-[var(--primary)] ring-1 ring-[var(--primary-border)]">
                  <Bot className="h-3.5 w-3.5" aria-hidden />
                </div>
              )}
              <button
                type="button"
                disabled={isUser}
                onClick={() => {
                  if (!isUser) onSelectAssistant(m.id);
                }}
                className={cn(
                  "max-w-[min(100%,40rem)] rounded-2xl px-3.5 py-2.5 text-left text-sm shadow-sm transition-colors",
                  isUser
                    ? "bg-[var(--primary-soft)] text-[var(--fg)] ring-1 ring-[var(--primary-border)]"
                    : "border border-[var(--border)] bg-[var(--bg-elevated)] text-[var(--fg)] hover:border-[var(--border-strong)] hover:shadow-md",
                  active &&
                    !isUser &&
                    "border-[var(--primary-border)] ring-1 ring-[var(--primary-border)] shadow-md",
                  !isUser && "cursor-pointer",
                )}
              >
                {isUser ? (
                  <p className="whitespace-pre-wrap leading-relaxed">
                    {m.content}
                  </p>
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
                    <p className="mt-2 text-[11px] text-[var(--fg-subtle)]">
                      Searched: {m.expandedQuery}
                    </p>
                  )}
                {!isUser && m.timing?.totalMs != null && (
                  <p className="mt-2 text-[11px] text-[var(--fg-subtle)]">
                    {m.timing.totalMs}ms
                    {m.results?.length
                      ? ` · ${m.results.length} sources`
                      : ""}
                  </p>
                )}
              </button>
              {isUser && (
                <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[var(--surface)] text-[var(--fg-muted)] ring-1 ring-[var(--border)]">
                  <User className="h-3.5 w-3.5" aria-hidden />
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
