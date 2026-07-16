"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function Markdown({ content }: { content: string }) {
  if (!content) return null;
  return (
    <div className="prose prose-invert prose-sm max-w-none prose-a:text-emerald-400 prose-strong:text-zinc-100">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  );
}
