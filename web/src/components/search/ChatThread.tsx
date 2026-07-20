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
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-4 py-6">
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
                "anim-message flex gap-2.5 sm:gap-3",
                isUser ? "justify-end" : "justify-start",
              )}
            >
              {!isUser && (
                <div className="msg-avatar msg-avatar--bot" aria-hidden>
                  <Bot className="h-3.5 w-3.5" />
                </div>
              )}
              <button
                type="button"
                disabled={isUser}
                onClick={() => {
                  if (!isUser) onSelectAssistant(m.id);
                }}
                className={cn(
                  "msg-bubble hover-lift",
                  isUser ? "msg-bubble--user" : "msg-bubble--assistant",
                  active && "msg-bubble--active",
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
                    {m.streaming ? (
                      <span className="inline-flex items-center gap-2">
                        <span className="inline-flex gap-1" aria-hidden>
                          <span className="thinking-dot" />
                          <span className="thinking-dot" />
                          <span className="thinking-dot" />
                        </span>
                        Thinking…
                      </span>
                    ) : (
                      "No answer yet."
                    )}
                  </p>
                )}
                {isUser &&
                  m.expandedQuery &&
                  m.expandedQuery !== m.content && (
                    <p className="mt-2 rounded-md bg-white/50 px-2 py-1 text-[11px] text-[var(--fg-subtle)]">
                      Searched: {m.expandedQuery}
                    </p>
                  )}
                {!isUser && m.timing?.totalMs != null && (
                  <p className="mt-2.5 border-t border-[var(--border)] pt-2 text-[11px] text-[var(--fg-subtle)]">
                    {m.timing.totalMs}ms
                    {m.results?.length
                      ? ` · ${m.results.length} sources`
                      : ""}
                    {active ? " · viewing evidence" : ""}
                  </p>
                )}
              </button>
              {isUser && (
                <div className="msg-avatar msg-avatar--user" aria-hidden>
                  <User className="h-3.5 w-3.5" />
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
