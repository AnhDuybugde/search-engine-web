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

  const reset = useCallback(() => {
    abortRef.current?.abort();
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

  const run = useCallback(async (url: string, body: unknown) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setState({
      status: "running",
      answer: "",
      results: [],
      timing: null,
      metrics: null,
      error: null,
      logs: ["Starting…"],
      steps: {
        search: "running",
        fetch: "pending",
        chunk: "pending",
        retrieve: "pending",
        generate: "pending",
      },
    });

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        const text = await res.text();
        throw new Error(text || `HTTP ${res.status}`);
      }

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

          setState((prev) => applyEvent(prev, event));
        }
      }

      setState((prev) =>
        prev.status === "running"
          ? { ...prev, status: "completed" }
          : prev,
      );
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setState((prev) => ({
        ...prev,
        status: "failed",
        error: err instanceof Error ? err.message : "Request failed",
        logs: [...prev.logs, `Error: ${err instanceof Error ? err.message : "failed"}`],
      }));
    }
  }, []);

  return { state, run, reset, cancel, hydrate };
}

function applyEvent(prev: SseState, event: StreamEvent): SseState {
  const logs = [...prev.logs];
  const steps = { ...prev.steps };

  switch (event.type) {
    case "search_started":
      logs.push(`Search: ${event.query}`);
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
      logs.push(`Retrieved ${event.results.length} evidence chunks (${event.ms}ms)`);
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
      // Keep running until run_completed; surface error without wiping answer/results
      return {
        ...prev,
        logs,
        error: event.message,
        steps: {
          ...steps,
          generate: prev.steps.generate === "running" ? "failed" : prev.steps.generate,
        },
      };
    default:
      return prev;
  }
}
