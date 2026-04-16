/**
 * POST /api/agent/generate
 * Generate-only mode: Explore → Generate scenarios (no execution, no report)
 * Streams progress via SSE and returns generated QAScenario[] on complete
 */

import { NextRequest } from "next/server";
import { z } from "zod";
import { SiteExplorer } from "@/lib/agent/explorer";
import { ScenarioGenerator } from "@/lib/agent/scenario-gen";
import type { QAScenario } from "@/lib/ai/types";
import { logger } from "@/lib/logger";

const RequestSchema = z.object({
  targetUrl: z.string().url(),
  loginEmail: z.string().email().optional(),
  loginPassword: z.string().optional(),
  maxScenarios: z.number().min(1).max(30).default(15),
  scenarioCategories: z.array(z.string()).optional(),
  customPrompt: z.string().max(2000).optional(),
  scenarioHints: z.array(z.string()).optional(),
  sheetRawTable: z.string().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = RequestSchema.safeParse(body);

    if (!parsed.success) {
      return new Response(
        JSON.stringify({ error: "Invalid request", details: parsed.error.flatten() }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const { targetUrl, loginEmail, loginPassword, maxScenarios, scenarioCategories, customPrompt, scenarioHints, sheetRawTable } = parsed.data;

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (data: unknown) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        };

        try {
          send({ type: "start", message: "사이트 탐색 시작...", targetUrl, progress: 5 });

          // ── Stage 1: Explore ──────────────────────────────────
          const explorer = new SiteExplorer({
            targetUrl,
            loginEmail,
            loginPassword,
            maxRoutes: 15,
            timeBudgetMs: 60_000,
          });

          send({ type: "progress", stage: "exploring", message: "사이트 구조 분석 중...", progress: 10 });

          const structure = await explorer.explore();

          send({
            type: "progress",
            stage: "exploring",
            message: `${structure.routes.length}개 라우트, ${structure.forms.length}개 폼, SPA: ${structure.spa}`,
            progress: 40,
            data: { routeCount: structure.routes.length, formCount: structure.forms.length, technologies: structure.technologies },
          });

          // ── Sheet info ────────────────────────────────────────
          if (sheetRawTable) {
            const rowCount = sheetRawTable.split("\n").length - 2;
            send({ type: "progress", stage: "generating", message: `📄 시트 ${rowCount}행 로드됨 → AI가 자유 해석 후 시나리오에 반영`, progress: 48 });
          } else if (scenarioHints?.length) {
            send({ type: "progress", stage: "generating", message: `📄 시트 ${scenarioHints.length}개 힌트 로드됨 → AI가 Playwright 단계로 변환`, progress: 48 });
          }

          // ── Stage 2: Generate ─────────────────────────────────
          send({ type: "progress", stage: "generating", message: "AI 시나리오 생성 중...", progress: 55 });

          const generator = new ScenarioGenerator();
          const scenarios: QAScenario[] = (
            await generator.generate(
              structure,
              targetUrl,
              scenarioCategories,
              { email: loginEmail, password: loginPassword },
              { customPrompt, scenarioHints, sheetRawTable }
            )
          ).slice(0, maxScenarios);

          send({
            type: "complete",
            scenarios,
            structure,
            message: `${scenarios.length}개 시나리오 생성 완료`,
            progress: 100,
          });
        } catch (err) {
          logger.error({ err }, "Generate-only error");
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
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
