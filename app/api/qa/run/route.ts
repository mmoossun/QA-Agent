/**
 * POST /api/qa/run
 * Run QA scenarios against a target URL
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { QARunner } from "@/lib/qa/runner";
import { QAReporter } from "@/lib/agent/reporter";
import { logger } from "@/lib/logger";
import { v4 as uuidv4 } from "uuid";

const RequestSchema = z.object({
  scenarios: z.array(z.any()).min(1),
  targetUrl: z.string().url(),
  loginEmail: z.string().email().optional(),
  loginPassword: z.string().optional(),
  options: z
    .object({
      headless: z.boolean().default(true),
      maxRetries: z.number().min(0).max(5).default(1),
      screenshotOnStep: z.boolean().default(false),
    })
    .default({}),
});

export async function POST(req: NextRequest) {
  const startTime = Date.now();
  const runId = uuidv4().slice(0, 12);

  try {
    const body = await req.json();
    const parsed = RequestSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
    }

    const { scenarios, targetUrl, loginEmail, loginPassword, options } = parsed.data;

    logger.info({ runId, url: targetUrl, count: scenarios.length }, "QA run started");

    const runner = new QARunner({
      baseUrl: targetUrl,
      loginEmail,
      loginPassword,
      options: {
        headless: options.headless,
        maxRetries: options.maxRetries,
        screenshotOnStep: options.screenshotOnStep,
      },
    });

    await runner.init();
    let results;
    try {
      results = await runner.runAll(scenarios);
    } finally {
      await runner.close();
    }

    const duration = Date.now() - startTime;
    const reporter = new QAReporter();
    const report = await reporter.generate(runId, targetUrl, scenarios, results, duration);

    logger.info({ runId, score: report.score, passRate: report.passRate.toFixed(1) }, "QA run complete");

    return NextResponse.json({ success: true, runId, report });
  } catch (err) {
    logger.error({ runId, err }, "QA run error");
    return NextResponse.json({ error: "QA run failed", detail: String(err) }, { status: 500 });
  }
}
