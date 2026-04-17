/**
 * POST /api/human-agent/run
 * Human-mode QA agent — GPT-4o Vision + Playwright loop
 * Streams each step via SSE with keep-alive pings every 15s
 *
 * After run completes:
 *  1. Generates structured QA report (GPT-4o analysis)
 *  2. Saves result + embedding to test-memory store
 */

import { NextRequest } from "next/server";
import { z } from "zod";
import { HumanAgentRunner } from "@/lib/human-agent/runner";
import { generateReport } from "@/lib/human-agent/report-generator";
import { saveTestMemory, searchSimilarTests } from "@/lib/memory/test-store";
import { logger } from "@/lib/logger";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

const RequestSchema = z.object({
  targetUrl: z.string().url(),
  goal: z.string().max(500).optional().default(""),
  loginEmail: z.string().email().optional(),
  loginPassword: z.string().optional(),
  maxSteps: z.number().min(1).max(100).default(20),
  categories: z.array(z.string()).optional(),
  customPrompt: z.string().optional(),
  sheetRawTable: z.string().optional(),
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
            controller.enqueue(encoder.encode(": keep-alive\n\n"));
          } catch { /* ignore */ }
        };

        const pingInterval = setInterval(ping, 15_000);

        try {
          send({ type: "start", message: "Human Agent v4 시작 — GPT-4o 비전+플래닝", targetUrl, goal });

          if (sheetRawTable) {
            const rowCount = sheetRawTable.split("\n").length - 2;
            send({ type: "info", message: `📄 시트 ${rowCount}행 로드됨 → AI가 자유 해석 후 테스트에 반영` });
          }

          // ── Query similar past tests for context injection ──
          let similarContext = "";
          try {
            const queryText = `URL: ${targetUrl}\nGoal: ${goal}`;
            const similar = await searchSimilarTests(queryText, 3, 0.65);
            if (similar.length > 0) {
              send({ type: "info", message: `🧠 유사한 과거 테스트 ${similar.length}건 참고 (메모리 활성화)` });
              similarContext = similar.map(r =>
                `[${r.createdAt.slice(0, 10)} | ${r.status} | ${r.passRate.toFixed(0)}% 성공]\n` +
                `목표: ${r.goal || "자유 탐색"}\n` +
                (r.failedSteps.length > 0
                  ? `실패: ${r.failedSteps.map(f => `Step${f.stepNumber}[${f.action}] ${f.description} → ${f.error}`).join(" | ")}`
                  : "모든 스텝 성공")
              ).join("\n\n");
            }
          } catch { /* memory query failure is non-critical */ }

          const runner = new HumanAgentRunner({
            targetUrl,
            goal,
            loginEmail,
            loginPassword,
            maxSteps,
            categories,
            customPrompt,
            sheetRawTable,
            similarContext,
            onStep: (step) => send({ type: "step", step }),
          });

          const result = await runner.run();
          send({ type: "complete", result });

          // ── Generate structured report ──────────────────────
          send({ type: "info", message: "📊 AI 리포트 생성 중..." });
          try {
            const report = await generateReport(result);
            send({ type: "report", report });
          } catch (reportErr) {
            logger.warn({ reportErr }, "Report generation failed");
          }

          // ── Save to memory (non-blocking) ───────────────────
          saveTestMemory(result).catch(e => logger.warn({ e }, "Memory save failed"));

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
        "X-Accel-Buffering": "no",
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
}
