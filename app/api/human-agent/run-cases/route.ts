/**
 * POST /api/human-agent/run-cases
 * Checkpoint-based single-session execution — one browser run covers all cases.
 * Agent uses check_case action to signal per-case completion.
 * Streams progress via SSE.
 */

import { NextRequest } from "next/server";
import { z } from "zod";
import { HumanAgentRunner } from "@/lib/human-agent/runner";
import { logger } from "@/lib/logger";

export const maxDuration = 600;
export const dynamic = "force-dynamic";

const TestCaseSchema = z.object({
  id: z.string(),
  title: z.string(),
  steps: z.string(),
  expectedResult: z.string(),
});

const RequestSchema = z.object({
  targetUrl: z.string().url(),
  testCases: z.array(TestCaseSchema).min(1).max(50),
  loginEmail: z.string().email().optional(),
  loginPassword: z.string().optional(),
  maxSteps: z.number().min(5).max(200).default(60),
  categories: z.array(z.string()).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = RequestSchema.safeParse(body);

    if (!parsed.success) {
      return new Response(
        JSON.stringify({ error: "Invalid request", details: parsed.error.flatten() }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    const { targetUrl, testCases, loginEmail, loginPassword, maxSteps, categories } = parsed.data;

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        let closed = false;
        const send = (data: unknown) => {
          if (closed) return;
          try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`)); } catch { /* closed */ }
        };
        const ping = () => {
          if (closed) return;
          try { controller.enqueue(encoder.encode(": keep-alive\n\n")); } catch { /* closed */ }
        };
        const pingInterval = setInterval(ping, 15_000);

        try {
          send({
            type: "start",
            message: `체크포인트 실행 시작 — ${testCases.length}개 케이스, 단일 브라우저 세션`,
            targetUrl,
            totalCases: testCases.length,
          });

          const goal = [
            `아래 ${testCases.length}개 테스트 케이스를 모두 수행하세요.`,
            `각 케이스 완료 후 check_case로 결과를 신고하고, 모두 완료된 후에만 done을 사용하세요.`,
            `로그인, 팝업, 페이지 이동 등 중간 작업은 자유롭게 처리하세요.`,
          ].join(" ");

          const runner = new HumanAgentRunner({
            targetUrl,
            goal,
            loginEmail,
            loginPassword,
            maxSteps,
            categories,
            testCases,
            onStep: (step) => {
              send({ type: "step", step });
            },
            onCaseCheck: (caseId, status, description) => {
              const tc = testCases.find(c => c.id === caseId);
              send({
                type: "case_checkpoint",
                caseId,
                title: tc?.title ?? caseId,
                status,
                description,
              });
              logger.info(`[checkpoint] case=${caseId} status=${status}`);
            },
          });

          const result = await runner.run();

          send({ type: "complete", result });

        } catch (err) {
          logger.error({ err }, "run-cases error");
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
        "X-Accel-Buffering": "no",
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
}
