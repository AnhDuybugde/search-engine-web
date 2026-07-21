"use client";

import { useCallback, useRef, useState } from "react";
import type { Timing, UploadStreamEvent } from "@/lib/ir/types";

export type UploadStepStatus = "pending" | "running" | "success" | "failed";

export type UploadSseState = {
  status: "idle" | "running" | "completed" | "failed";
  filename: string | null;
  error: string | null;
  logs: string[];
  timing: Timing | null;
  steps: Record<string, UploadStepStatus>;
  stepMs: Record<string, number | undefined>;
  /** 0–100 during embed step */
  indexPercent: number | null;
  indexMessage: string | null;
  result: {
    id: string;
    title: string;
    chunkCount: number;
    charCount: number;
    mode?: string;
  } | null;
  metrics: {
    chunkCount?: number;
    charCount?: number;
    embeddedCount?: number;
    mode?: string;
    indexStatus?: string;
    storage?: string;
  } | null;
};

/** Full pipeline: receive → extract → store → embed → persist */
const initialSteps: Record<string, UploadStepStatus> = {
  receive: "pending",
  extract: "pending",
  store: "pending",
  embed: "pending",
  persist: "pending",
};

export function useUploadSse() {
  const abortRef = useRef<AbortController | null>(null);
  const [state, setState] = useState<UploadSseState>({
    status: "idle",
    filename: null,
    error: null,
    logs: [],
    timing: null,
    steps: { ...initialSteps },
    stepMs: {},
    indexPercent: null,
    indexMessage: null,
    result: null,
    metrics: null,
  });

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setState({
      status: "idle",
      filename: null,
      error: null,
      logs: [],
      timing: null,
      steps: { ...initialSteps },
      stepMs: {},
      indexPercent: null,
      indexMessage: null,
      result: null,
      metrics: null,
    });
  }, []);

  const upload = useCallback(async (url: string, file: File) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setState({
      status: "running",
      filename: file.name,
      error: null,
      logs: [`Uploading ${file.name}…`],
      timing: null,
      steps: {
        receive: "running",
        extract: "pending",
        store: "pending",
        embed: "pending",
        persist: "pending",
      },
      stepMs: {},
      indexPercent: null,
      indexMessage: null,
      result: null,
      metrics: null,
    });

    try {
      const form = new FormData();
      form.append("file", file);

      const res = await fetch(url, {
        method: "POST",
        headers: {
          Accept: "text/event-stream",
          "x-upload-stream": "1",
        },
        body: form,
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
          /* plain */
        }
        throw new Error(message);
      }

      const ct = res.headers.get("content-type") || "";
      if (ct.includes("application/json")) {
        const data = await res.json();
        setState({
          status: "completed",
          filename: file.name,
          error: null,
          logs: [
            `Stored ${data.title} (${data.charCount ?? 0} chars). Index scheduled in background.`,
          ],
          timing: data.timing || null,
          steps: {
            receive: "success",
            extract: "success",
            store: "success",
            embed: "pending",
            persist: "pending",
          },
          stepMs: {
            extract: data.timing?.extractMs,
            store: data.timing?.storeMs,
          },
          indexPercent: null,
          indexMessage: "Indexing scheduled (no live progress on JSON path)",
          result: {
            id: data.id,
            title: data.title,
            chunkCount: data.chunkCount ?? 0,
            charCount: data.charCount,
            mode: data.mode,
          },
          metrics: {
            chunkCount: data.chunkCount ?? 0,
            charCount: data.charCount,
            embeddedCount: data.embeddedCount ?? 0,
            mode: data.mode,
          },
        });
        return data;
      }

      if (!res.body) throw new Error("No upload stream body");

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
          let event: UploadStreamEvent;
          try {
            event = JSON.parse(payload) as UploadStreamEvent;
          } catch {
            continue;
          }
          setState((prev) => applyUploadEvent(prev, event));
        }
      }

      setState((prev) =>
        prev.status === "running" ? { ...prev, status: "completed" } : prev,
      );
    } catch (err) {
      if ((err as Error).name === "AbortError") return null;
      setState((prev) => ({
        ...prev,
        status: "failed",
        error: err instanceof Error ? err.message : "Upload failed",
        logs: [
          ...prev.logs,
          `Error: ${err instanceof Error ? err.message : "failed"}`,
        ],
      }));
      throw err;
    }
  }, []);

  return { state, upload, reset };
}

function applyUploadEvent(
  prev: UploadSseState,
  event: UploadStreamEvent,
): UploadSseState {
  const logs = [...prev.logs];
  const steps = { ...prev.steps };
  const stepMs = { ...prev.stepMs };
  let indexPercent = prev.indexPercent;
  let indexMessage = prev.indexMessage;

  switch (event.type) {
    case "upload_started":
      logs.push(`Received ${event.filename} (${event.bytes} bytes)`);
      steps.receive = "success";
      steps.extract = "running";
      return { ...prev, logs, steps, filename: event.filename };
    case "extract_completed":
      logs.push(`Extracted ${event.chars} chars (${event.ms}ms)`);
      steps.extract = "success";
      steps.store = "running";
      stepMs.extract = event.ms;
      return { ...prev, logs, steps, stepMs };
    case "store_completed":
      logs.push(`Stored raw source ${event.sourceId} (${event.ms}ms)`);
      steps.store = "success";
      steps.embed = "running";
      stepMs.store = event.ms;
      return { ...prev, logs, steps, stepMs };
    case "index_started":
      logs.push(event.message);
      steps.embed = "running";
      indexPercent = 0;
      indexMessage = event.message;
      return { ...prev, logs, steps, indexPercent, indexMessage };
    case "index_progress": {
      logs.push(event.message);
      const pct =
        event.total > 0
          ? Math.min(100, Math.round((event.done / event.total) * 100))
          : 0;
      indexPercent = pct;
      indexMessage = event.message;
      if (event.message.toLowerCase().includes("writing")) {
        steps.embed = "success";
        steps.persist = "running";
      }
      return { ...prev, logs, steps, indexPercent, indexMessage };
    }
    case "index_completed":
      logs.push(`✓ ${event.message}`);
      steps.embed = "success";
      steps.persist = "success";
      stepMs.embed = event.embedMs;
      indexPercent = 100;
      indexMessage = event.message;
      return { ...prev, logs, steps, stepMs, indexPercent, indexMessage };
    case "index_failed":
      logs.push(`✗ Index failed: ${event.message}`);
      if (steps.persist === "running") steps.persist = "failed";
      else if (steps.embed === "running" || steps.embed === "pending") {
        steps.embed = "failed";
      } else {
        steps.persist = "failed";
      }
      indexMessage = event.message;
      return {
        ...prev,
        logs,
        steps,
        indexMessage,
        // Keep stream going to upload_completed
      };
    case "index_skipped":
      logs.push(`⊘ ${event.message}`);
      steps.embed = "success";
      steps.persist = "success";
      indexMessage = event.message;
      indexPercent = null;
      return { ...prev, logs, steps, indexPercent, indexMessage };
    case "upload_completed":
      logs.push(
        `Done · ${event.source.charCount} chars · ${event.metrics.embeddedCount ?? 0} vectors · ${event.metrics.mode || "—"} · ${event.timing.totalMs ?? "?"}ms`,
      );
      steps.receive = "success";
      steps.extract = "success";
      steps.store = "success";
      if (event.metrics.mode === "index-failed") {
        // already marked
      } else if (event.metrics.mode === "index-skipped") {
        steps.embed = "success";
        steps.persist = "success";
      } else if ((event.metrics.embeddedCount ?? 0) > 0) {
        steps.embed = "success";
        steps.persist = "success";
      }
      return {
        ...prev,
        status:
          event.metrics.mode === "index-failed" ? "failed" : "completed",
        error:
          event.metrics.mode === "index-failed"
            ? event.metrics.indexStatus || "Indexing failed"
            : prev.error,
        logs,
        steps,
        stepMs: {
          extract: event.timing.extractMs ?? stepMs.extract,
          store: event.timing.storeMs ?? stepMs.store,
          embed: event.timing.embedMs ?? stepMs.embed,
        },
        timing: event.timing,
        result: event.source,
        metrics: event.metrics,
        indexMessage: prev.indexMessage,
      };
    case "error":
      logs.push(`Error: ${event.message}`);
      return {
        ...prev,
        status: "failed",
        error: event.message,
        logs,
        steps: Object.fromEntries(
          Object.entries(steps).map(([k, v]) => [
            k,
            v === "running" ? "failed" : v,
          ]),
        ) as Record<string, UploadStepStatus>,
      };
    default:
      return prev;
  }
}
