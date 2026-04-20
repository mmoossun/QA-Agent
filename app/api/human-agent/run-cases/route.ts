/**
 * POST /api/human-agent/run-cases
 * Sequential test case execution — one browser session, N focused runs
 * Each test case gets its own isolated agent loop with a precise goal.
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
  maxStepsPerCase: z.number().min(3).max(30).default(15),
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

    const { targetUrl, testCases, loginEmail, loginPassword, maxStepsPerCase, categories } = parsed.data;

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
          send({ type: "start", message: `테스트 케이스 순차 실행 시작 — ${testCases.length}개 케이스`, targetUrl });

          const runner = new HumanAgentRunner({
            targetUrl,
            goal: "",  // overridden per case inside runTestCases
            loginEmail,
            loginPassword,
            maxSteps: maxStepsPerCase,
            categories,
          });

          const results = await runner.runTestCases(testCases, maxStepsPerCase, {
            onCaseStart: (idx, tc) => {
              send({ type: "case_start", caseIndex: idx, total: testCases.length, caseId: tc.id, title: tc.title });
            },
            onStep: (step, caseIdx, caseId) => {
              send({ type: "step", step, caseIndex: caseIdx, caseId });
            },
            onCaseComplete: (result, idx) => {
              send({
                type: "case_complete",
                caseIndex: idx,
                caseId: result.caseId,
                title: result.title,
                status: result.status,
                summary: result.summary,
                stepCount: result.steps.length,
                durationMs: result.durationMs,
              });
            },
          });

          const passCount = results.filter(r => r.status === "done").length;
          const failCount = results.filter(r => r.status === "fail").length;
          const incompleteCount = results.filter(r => r.status === "max_steps").length;
          const allSteps = results.flatMap(r => r.steps);
          const totalDurationMs = results.reduce((sum, r) => sum + r.durationMs, 0);

          const summaryParts = [`총 ${testCases.length}개 케이스: ${passCount}개 통과, ${failCount}개 실패`];
          if (incompleteCount > 0) summaryParts.push(`${incompleteCount}개 미완료`);

          send({
            type: "complete",
            result: {
              sessionId: "",
              goal: `${testCases.length}개 테스트 케이스 순차 실행`,
              targetUrl,
              steps: allSteps,
              status: failCount > 0 ? "fail" : "done",
              summary: summaryParts.join(", "),
              totalDurationMs,
            },
            caseResults: results.map(r => ({
              caseId: r.caseId,
              title: r.title,
              status: r.status,
              summary: r.summary,
              stepCount: r.steps.length,
              durationMs: r.durationMs,
            })),
          });

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
