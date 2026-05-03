import { NextRequest } from "next/server";
import { sseSubscribe } from "@/lib/sse";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: { boardId: string } }) {
  const encoder = new TextEncoder();
  let unsub: (() => void) | null = null;
  let pingInterval: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    start(controller) {
      const send = (data: string) => {
        try { controller.enqueue(encoder.encode(data)); } catch { /* closed */ }
      };

      send(": connected\n\n");

      unsub = sseSubscribe(params.boardId, data => send(data));

      pingInterval = setInterval(() => send(": ping\n\n"), 30_000);
    },
    cancel() {
      if (pingInterval) clearInterval(pingInterval);
      unsub?.();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
