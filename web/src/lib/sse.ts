import type { StreamEvent } from "@/lib/ir/types";

export function encodeSse(event: StreamEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

export function createSseResponse(
  run: (emit: (event: StreamEvent) => void) => Promise<void>,
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: StreamEvent) => {
        controller.enqueue(encoder.encode(encodeSse(event)));
      };
      try {
        await run(emit);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        emit({ type: "error", message });
      } finally {
        controller.close();
      }
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
