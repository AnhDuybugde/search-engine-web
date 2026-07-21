import type { StreamEvent, UploadStreamEvent } from "@/lib/ir/types";

export function encodeSse(event: StreamEvent | UploadStreamEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

export type SseRunContext = {
  signal: AbortSignal;
};

/**
 * SSE response tuned for Vercel:
 * - emits immediately (including heartbeat)
 * - aborts run when client disconnects
 * - force-dynamic consumers should set maxDuration
 */
export function createSseResponse(
  run: (emit: (event: StreamEvent) => void, ctx: SseRunContext) => Promise<void>,
  req?: Request,
): Response {
  return createTypedSseResponse<StreamEvent>(run, req);
}

export function createUploadSseResponse(
  run: (
    emit: (event: UploadStreamEvent) => void,
    ctx: SseRunContext,
  ) => Promise<void>,
  req?: Request,
): Response {
  return createTypedSseResponse<UploadStreamEvent>(run, req);
}

function createTypedSseResponse<T extends { type: string }>(
  run: (emit: (event: T) => void, ctx: SseRunContext) => Promise<void>,
  req?: Request,
): Response {
  const encoder = new TextEncoder();
  let closed = false;
  const abort = new AbortController();

  const onReqAbort = () => abort.abort();
  req?.signal?.addEventListener("abort", onReqAbort);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const safeEnqueue = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true;
          abort.abort();
        }
      };

      const emit = (event: T) => {
        safeEnqueue(encodeSse(event as StreamEvent | UploadStreamEvent));
      };

      // Flush headers / first byte ASAP so UI doesn't look frozen on Vercel
      safeEnqueue(`: connected ${Date.now()}\n\n`);

      const heartbeat = setInterval(() => {
        safeEnqueue(`: ping ${Date.now()}\n\n`);
      }, 12000);

      try {
        await run(emit, { signal: abort.signal });
      } catch (err) {
        if ((err as Error)?.name === "AbortError") {
          emit({ type: "error", message: "Request cancelled" } as unknown as T);
        } else {
          const message = err instanceof Error ? err.message : "Unknown error";
          emit({ type: "error", message } as unknown as T);
        }
      } finally {
        clearInterval(heartbeat);
        closed = true;
        req?.signal?.removeEventListener("abort", onReqAbort);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
    cancel() {
      closed = true;
      abort.abort();
      req?.signal?.removeEventListener("abort", onReqAbort);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
