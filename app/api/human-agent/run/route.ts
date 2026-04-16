/**
 * POST /api/human-agent/run
 * Human-mode QA agent — GPT-4o Vision perception-action loop
 * Streams each step via SSE
 */

import { NextRequest } from "next/server";
import { z } from "zod";
import { HumanAgentRunner } from "@/lib/human-agent/runner";
import { logger } from "@/lib/logger";

const RequestSchema = z.object({
  targetUrl: z.string().url(),
  goal: z.string().min(1).max(500),
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
        const send = (data: unknown) =>
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));

        try {
          send({ type: "start", message: "Human Agent 시작 — 브라우저 실행 중...", targetUrl, goal });

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
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
}
