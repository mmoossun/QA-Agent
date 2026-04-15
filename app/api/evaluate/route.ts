/**
 * POST /api/evaluate
 * Evaluate QA system quality and return score breakdown
 */

import { NextRequest, NextResponse } from "next/server";
import { evaluateSystem } from "@/lib/evaluation/scorer";
import { logger } from "@/lib/logger";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { scenarios = [], results = [], executionDurationMs = 0 } = body;

    logger.info({ scenarios: scenarios.length, results: results.length }, "Evaluation requested");

    const score = await evaluateSystem({ scenarios, results, executionDurationMs });

    return NextResponse.json({ success: true, score });
  } catch (err) {
    logger.error({ err }, "Evaluation error");
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
