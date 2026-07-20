"use client";

import { useCallback, useRef, useState } from "react";
import type {
  Metrics,
  RankedChunk,
  RankedDocument,
  StreamEvent,
  Timing,
} from "@/lib/ir/types";

export type SseState = {
  status: "idle" | "running" | "completed" | "failed";
  answer: string;
  /** Packed LLM evidence (contextTopK) */
  results: RankedChunk[];
  /**
   * Full ranking hits for document drawer score breakdown.
   * Never replaced by pack-only retrieve_completed payload.
   */
  rankedChunks: RankedChunk[];
  documents: RankedDocument[];
  timing: Timing | null;
  metrics: Metrics | null;
  error: string | null;
  logs: string[];
  steps: Record<string, "pending" | "running" | "success" | "failed">;
};

const initialSteps = {
  corpus: "pending" as const,
  query: "pending" as const,
  retrieve: "pending" as const,
  embedding: "pending" as const,
  fusion: "pending" as const,
  pack: "pending" as const,
  generate: "pending" as const,
  // legacy keys still used by web-search pipeline path
  search: "pending" as const,
  fetch: "pending" as const,
  chunk: "pending" as const,
};

const emptyState = (): SseState => ({
  status: "idle",
  answer: "",
  results: [],
  rankedChunks: [],
  documents: [],
  timing: null,
  metrics: null,
  error: null,
  logs: [],
  steps: { ...initialSteps },
});

export function useSsePipeline() {
  const abortRef = useRef<AbortController | null>(null);
  const tokenBufferRef = useRef("");
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [state, setState] = useState<SseState>(emptyState);

  const flushTokens = useCallback(() => {
    if (!tokenBufferRef.current) return;
    const chunk = tokenBufferRef.current;
    tokenBufferRef.current = "";
    setState((prev) => ({
      ...prev,
      answer: prev.answer + chunk,
      steps: { ...prev.steps, generate: "running" },
    }));
  }, []);

  const scheduleTokenFlush = useCallback(() => {
    if (flushTimerRef.current) return;
    flushTimerRef.current = setTimeout(() => {
      flushTimerRef.current = null;
      flushTokens();
    }, 50);
  }, [flushTokens]);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    tokenBufferRef.current = "";
    if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
    setState(emptyState());
  }, []);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    tokenBufferRef.current = "";
    if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
    setState((s) => ({
      ...s,
      status: s.status === "running" ? "failed" : s.status,
      error: s.status === "running" ? "Cancelled" : s.error,
    }));
  }, []);

  const hydrate = useCallback(
    (snapshot: {
      answer?: string | null;
      results?: RankedChunk[] | null;
      rankedChunks?: RankedChunk[] | null;
      documents?: RankedDocument[] | null;
      timing?: Timing | null;
      metrics?: Metrics | null;
    }) => {
      abortRef.current?.abort();
      const packed = snapshot.results || [];
      const ranked = snapshot.rankedChunks || packed;
      setState({
        status: "completed",
        answer: snapshot.answer || "",
        results: packed,
        rankedChunks: ranked,
        documents: snapshot.documents || [],
        timing: snapshot.timing || null,
        metrics: snapshot.metrics || null,
        error: null,
        logs: ["Loaded from history"],
        steps: {
          ...initialSteps,
          corpus: "success",
          query: "success",
          retrieve: "success",
          generate: snapshot.answer ? "success" : "pending",
        },
      });
    },
    [],
  );

  const run = useCallback(
    async (url: string, body: unknown) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      tokenBufferRef.current = "";
      if (flushTimerRef.current) clearTimeout(flushTimerRef.current);

      setState({
        ...emptyState(),
        status: "running",
        logs: ["Connecting…"],
        steps: {
          ...initialSteps,
          corpus: "success",
          query: "running",
        },
      });

      await new Promise((r) => setTimeout(r, 0));

      try {
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "text/event-stream",
          },
          body: JSON.stringify(body),
          signal: controller.signal,
          cache: "no-store",
        });

        if (!res.ok) {
          const text = await res.text();
          let message = text || `HTTP ${res.status}`;
          try {
            const j = JSON.parse(text) as { error?: string };
            if (j.error) message = j.error;
          } catch {
            /* plain text */
          }
          throw new Error(message);
        }

        if (!res.body) {
          throw new Error("No response stream (empty body)");
        }

        setState((prev) => ({
          ...prev,
          logs: [...prev.logs, "Stream opened"],
        }));

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const parts = buffer.split("\n\n");
          buffer = parts.pop() || "";

          for (const part of parts) {
            const line = part
              .split("\n")
              .map((l) => l.trim())
              .find((l) => l.startsWith("data:"));
            if (!line) continue;
            const payload = line.slice(5).trim();
            if (!payload) continue;

            let event: StreamEvent;
            try {
              event = JSON.parse(payload) as StreamEvent;
            } catch {
              continue;
            }

            if (event.type === "generation_token") {
              tokenBufferRef.current += event.token;
              scheduleTokenFlush();
              continue;
            }

            if (tokenBufferRef.current) {
              if (flushTimerRef.current) {
                clearTimeout(flushTimerRef.current);
                flushTimerRef.current = null;
              }
              flushTokens();
            }

            setState((prev) => applySseEvent(prev, event));
          }
        }

        if (tokenBufferRef.current) {
          if (flushTimerRef.current) {
            clearTimeout(flushTimerRef.current);
            flushTimerRef.current = null;
          }
          flushTokens();
        }

        setState((prev) => finalizeSseOnStreamEnd(prev));
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        setState((prev) => ({
          ...prev,
          status: "failed",
          error: err instanceof Error ? err.message : "Request failed",
          logs: [
            ...prev.logs,
            `Error: ${err instanceof Error ? err.message : "failed"}`,
          ],
        }));
      }
    },
    [flushTokens, scheduleTokenFlush],
  );

  return { state, run, reset, cancel, hydrate };
}

/**
 * Terminal stream close handler — only `run_completed` may leave status=completed.
 * Partial answer/results without that event are treated as failure (R3).
 */
export function finalizeSseOnStreamEnd(prev: SseState): SseState {
  if (prev.status !== "running") return prev;
  return {
    ...prev,
    status: "failed",
    error: prev.error || "Stream ended without a completed answer",
  };
}

/** Pure SSE reducer — exported for unit tests on the real UI state path */
export function applySseEvent(prev: SseState, event: StreamEvent): SseState {
  const logs = [...prev.logs];
  const steps = { ...prev.steps };

  switch (event.type) {
    case "query_started":
      logs.push(`Query: ${event.query}`);
      steps.query = "running";
      steps.corpus = "success";
      return { ...prev, logs, steps };
    case "query_processed":
      logs.push(`Query processed (${event.ms}ms)`);
      steps.query = "success";
      steps.retrieve = "running";
      return { ...prev, logs, steps };
    case "retrieve_started":
      logs.push(
        `Retrieve started · mode=${event.mode} · corpus=${event.corpusChunks}`,
      );
      steps.retrieve = "running";
      return { ...prev, logs, steps };
    case "bm25_completed":
      logs.push(`BM25 done (${event.candidates} candidates, ${event.ms}ms)`);
      steps.retrieve = "success";
      steps.embedding = "running";
      return { ...prev, logs, steps };
    case "embedding_completed":
      logs.push(
        event.denseUsed
          ? `Embedding done (${event.ms}ms${event.model ? ` · ${event.model}` : ""})`
          : `Embedding skipped (${event.reason || "BM25 only"})`,
      );
      steps.embedding = "success";
      steps.fusion = "running";
      return { ...prev, logs, steps };
    case "fusion_completed":
      logs.push(
        `Fusion ${event.method} (${event.ms}ms${
          event.bm25Weight != null
            ? ` · w_BM25=${event.bm25Weight.toFixed(2)}`
            : ""
        })`,
      );
      steps.fusion = "success";
      steps.pack = "running";
      return { ...prev, logs, steps };
    case "pack_completed":
      logs.push(`Packed ${event.packed} chunks (${event.ms}ms)`);
      steps.pack = "success";
      return { ...prev, logs, steps };
    case "rank_completed":
      logs.push(
        `Top ${event.documents.length} documents ranked (${event.ms}ms)`,
      );
      steps.retrieve = "success";
      steps.fusion = "success";
      steps.pack = steps.pack === "pending" ? "success" : steps.pack;
      return {
        ...prev,
        logs,
        steps,
        documents: event.documents,
        // ranking hits for drawer — never treated as packed evidence
        rankedChunks: event.chunks.length ? event.chunks : prev.rankedChunks,
      };
    case "search_started":
      if (event.query) logs.push(`Search: ${event.query}`);
      steps.search = "running";
      steps.query = "running";
      return { ...prev, logs, steps };
    case "search_completed":
      logs.push(`Search done (${event.count} hits, ${event.ms}ms)`);
      steps.search = "success";
      steps.fetch = "running";
      return { ...prev, logs, steps };
    case "fetch_completed":
      logs.push(`Content ready (${event.pages} pages, ${event.ms}ms)`);
      steps.fetch = "success";
      steps.chunk = "running";
      return { ...prev, logs, steps };
    case "chunk_completed":
      logs.push(`Chunked ${event.chunks} pieces (${event.ms}ms)`);
      steps.chunk = "success";
      steps.retrieve = "running";
      steps.corpus = "success";
      return { ...prev, logs, steps };
    case "retrieve_completed":
      logs.push(
        `Packed evidence ${event.results.length} chunks (${event.ms}ms)`,
      );
      steps.retrieve = "success";
      // Only updates packed `results` — must not wipe `rankedChunks`
      return { ...prev, logs, steps, results: event.results };
    case "generation_started":
      logs.push("Generating answer…");
      steps.generate = "running";
      return { ...prev, logs, steps };
    case "generation_token":
      return { ...prev, answer: prev.answer + event.token, steps };
    case "run_completed":
      logs.push(`Completed in ${event.timing.totalMs ?? "?"}ms`);
      if (event.metrics.llmUsed) steps.generate = "success";
      else if (event.metrics.llmSkippedReason) {
        steps.generate =
          event.metrics.llmSkippedReason === "generateAnswer=false"
            ? "pending"
            : "failed";
        logs.push(`LLM: ${event.metrics.llmSkippedReason}`);
      }
      return {
        ...prev,
        status: "completed",
        answer: event.answer || prev.answer,
        results: event.results,
        rankedChunks:
          event.rankedChunks && event.rankedChunks.length
            ? event.rankedChunks
            : prev.rankedChunks.length
              ? prev.rankedChunks
              : event.results,
        documents: event.documents ?? prev.documents,
        timing: event.timing,
        metrics: event.metrics,
        logs,
        steps,
      };
    case "error":
      logs.push(`Error: ${event.message}`);
      return {
        ...prev,
        logs,
        error: event.message,
        status: prev.status === "completed" ? prev.status : "failed",
        steps: {
          ...steps,
          generate:
            prev.steps.generate === "running" ? "failed" : prev.steps.generate,
        },
      };
    default:
      return prev;
  }
}
