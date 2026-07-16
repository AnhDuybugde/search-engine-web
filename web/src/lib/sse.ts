import type { StreamEvent } from "@/lib/ir/types";

export function encodeSse(event: StreamEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

/**
 * SSE response tuned for Vercel:
 * - emits immediately (including heartbeat)
 * - force-dynamic consumers should set maxDuration
 */
export function createSseResponse(
  run: (emit: (event: StreamEvent) => void) => Promise<void>,
): Response {
  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const safeEnqueue = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true;
        }
      };

      const emit = (event: StreamEvent) => {
        safeEnqueue(encodeSse(event));
      };

      // Flush headers / first byte ASAP so UI doesn't look frozen on Vercel
      safeEnqueue(`: connected ${Date.now()}\n\n`);

      const heartbeat = setInterval(() => {
        safeEnqueue(`: ping ${Date.now()}\n\n`);
      }, 12000);

      try {
        await run(emit);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        emit({ type: "error", message });
      } finally {
        clearInterval(heartbeat);
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
    cancel() {
      closed = true;
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
