/**
 * POST /api/human-agent/run
 * Human-mode QA agent — GPT-4o Vision + Playwright loop
 * Streams each step via SSE with keep-alive pings every 15s
 */

import { NextRequest } from "next/server";
import { z } from "zod";
import { HumanAgentRunner } from "@/lib/human-agent/runner";
import { logger } from "@/lib/logger";

// Prevent Next.js from caching/timing out this route
export const maxDuration = 300; // 5 minutes (Vercel Pro / self-hosted)
export const dynamic = "force-dynamic";

const RequestSchema = z.object({
  targetUrl: z.string().url(),
  goal: z.string().max(500).optional().default(""),
  loginEmail: z.string().email().optional(),
  loginPassword: z.string().optional(),
  maxSteps: z.number().min(1).max(30).default(20),
  categories: z.array(z.string()).optional(),
  customPrompt: z.string().optional(),
  sheetRawTable: z.string().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = RequestSchema.safeParse(body);

    if (!parsed.success) {
      return new Response(JSON.stringify({ error: "Invalid request", details: parsed.error.flatten() }), {
        status: 400, headers: { "Content-Type": "application/json" },
      });
    }

    const { targetUrl, goal, loginEmail, loginPassword, maxSteps, categories, customPrompt, sheetRawTable } = parsed.data;

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        let closed = false;

        const send = (data: unknown) => {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
          } catch { /* stream already closed */ }
        };

        const ping = () => {
          if (closed) return;
          try {
            // SSE comment — keeps the connection alive without triggering the client
            controller.enqueue(encoder.encode(": keep-alive\n\n"));
          } catch { /* ignore */ }
        };

        // Send keep-alive ping every 15 seconds
        const pingInterval = setInterval(ping, 15_000);

        try {
          send({ type: "start", message: "Human Agent v4 시작 — GPT-4o 비전+플래닝 (Qwen 제거, 5-10× 빠름)", targetUrl, goal });

          if (sheetRawTable) {
            const rowCount = sheetRawTable.split("\n").length - 2;
            send({ type: "info", message: `📄 시트 ${rowCount}행 로드됨 → AI가 자유 해석 후 테스트에 반영` });
          }

          const runner = new HumanAgentRunner({
            targetUrl,
            goal,
            loginEmail,
            loginPassword,
            maxSteps,
            categories,
            customPrompt,
            sheetRawTable,
            onStep: (step) => send({ type: "step", step }),
          });

          const result = await runner.run();
          send({ type: "complete", result });
        } catch (err) {
          logger.error({ err }, "Human agent error");
          send({ type: "error", message: String(err) });
        } finally {
          clearInterval(pingInterval);
          closed = true;
          try { controller.close(); } catch { /* already closed */ }
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",    // disable Nginx buffering
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
}
