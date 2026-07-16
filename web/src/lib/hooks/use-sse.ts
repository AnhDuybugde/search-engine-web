"use client";

import { useCallback, useRef, useState } from "react";
import type { Metrics, RankedChunk, StreamEvent, Timing } from "@/lib/ir/types";

export type SseState = {
  status: "idle" | "running" | "completed" | "failed";
  answer: string;
  results: RankedChunk[];
  timing: Timing | null;
  metrics: Metrics | null;
  error: string | null;
  logs: string[];
  steps: Record<string, "pending" | "running" | "success" | "failed">;
};

const initialSteps = {
  search: "pending" as const,
  fetch: "pending" as const,
  chunk: "pending" as const,
  retrieve: "pending" as const,
  generate: "pending" as const,
};

export function useSsePipeline() {
  const abortRef = useRef<AbortController | null>(null);
  const tokenBufferRef = useRef("");
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [state, setState] = useState<SseState>({
    status: "idle",
    answer: "",
    results: [],
    timing: null,
    metrics: null,
    error: null,
    logs: [],
    steps: { ...initialSteps },
  });

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
    // Batch tokens ~50ms to keep UI smooth (avoid main-thread freeze)
    flushTimerRef.current = setTimeout(() => {
      flushTimerRef.current = null;
      flushTokens();
    }, 50);
  }, [flushTokens]);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    tokenBufferRef.current = "";
    if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
    setState({
      status: "idle",
      answer: "",
      results: [],
      timing: null,
      metrics: null,
      error: null,
      logs: [],
      steps: { ...initialSteps },
    });
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
      timing?: Timing | null;
      metrics?: Metrics | null;
    }) => {
      abortRef.current?.abort();
      setState({
        status: "completed",
        answer: snapshot.answer || "",
        results: snapshot.results || [],
        timing: snapshot.timing || null,
        metrics: snapshot.metrics || null,
        error: null,
        logs: ["Loaded from history"],
        steps: {
          search: "success",
          fetch: "success",
          chunk: "success",
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

      // Immediate UI feedback BEFORE network wait
      setState({
        status: "running",
        answer: "",
        results: [],
        timing: null,
        metrics: null,
        error: null,
        logs: ["Connecting…"],
        steps: {
          search: "running",
          fetch: "pending",
          chunk: "pending",
          retrieve: "pending",
          generate: "pending",
        },
      });

      // Yield to paint loading UI
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

            // Flush any pending tokens before other events
            if (tokenBufferRef.current) {
              if (flushTimerRef.current) {
                clearTimeout(flushTimerRef.current);
                flushTimerRef.current = null;
              }
              flushTokens();
            }

            setState((prev) => applyEvent(prev, event));
          }
        }

        if (tokenBufferRef.current) {
          if (flushTimerRef.current) {
            clearTimeout(flushTimerRef.current);
            flushTimerRef.current = null;
          }
          flushTokens();
        }

        setState((prev) =>
          prev.status === "running" ? { ...prev, status: "completed" } : prev,
        );
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

function applyEvent(prev: SseState, event: StreamEvent): SseState {
  const logs = [...prev.logs];
  const steps = { ...prev.steps };

  switch (event.type) {
    case "search_started":
      if (event.query) logs.push(`Search: ${event.query}`);
      steps.search = "running";
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
      return { ...prev, logs, steps };
    case "retrieve_completed":
      logs.push(
        `Retrieved ${event.results.length} evidence chunks (${event.ms}ms)`,
      );
      steps.retrieve = "success";
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
        steps.generate = "failed";
        logs.push(`LLM skipped: ${event.metrics.llmSkippedReason}`);
      }
      return {
        ...prev,
        status: "completed",
        answer: event.answer || prev.answer,
        results: event.results,
        timing: event.timing,
        metrics: event.metrics,
        logs,
        steps,
      };
    case "error":
      logs.push(`Warning: ${event.message}`);
      return {
        ...prev,
        logs,
        error: event.message,
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
