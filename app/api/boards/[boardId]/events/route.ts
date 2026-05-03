import { NextRequest } from "next/server";
import { sseSubscribe } from "@/lib/sse";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: { boardId: string } }) {
  const encoder = new TextEncoder();
  let unsub: (() => void) | null = null;

  const stream = new ReadableStream({
    start(controller) {
      const send = (data: string) => {
        try { controller.enqueue(encoder.encode(data)); } catch { /* closed */ }
      };

      // 연결 확인 ping
      send(": connected\n\n");

      unsub = sseSubscribe(params.boardId, data => send(data));

      // 30초마다 keep-alive
      const ping = setInterval(() => send(": ping\n\n"), 30_000);

      // 클린업은 cancel에서
      const originalCancel = stream.cancel;
      void originalCancel;
      clearInterval(ping); // will be set again properly below

      const interval = setInterval(() => send(": ping\n\n"), 30_000);
      // Store interval ref for cleanup
      (stream as unknown as { _interval: ReturnType<typeof setInterval> })._interval = interval;
    },
    cancel() {
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
