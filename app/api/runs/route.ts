/**
 * GET  /api/runs — recent QA run history for the dashboard
 * POST /api/runs — save a new run record
 */

import { NextRequest, NextResponse } from "next/server";
import { loadRuns, saveRun } from "@/lib/db/history";
import { randomUUID } from "crypto";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const limit = Math.min(Number(searchParams.get("limit") ?? 50), 200);

  const runs = loadRuns().slice(0, limit);
  return NextResponse.json({ runs });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const record = {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      mode: body.mode ?? "human",
      targetUrl: body.targetUrl ?? "",
      scenarioCount: body.scenarioCount ?? 0,
      passCount: body.passCount ?? 0,
      failCount: body.failCount ?? 0,
      score: body.score ?? null,
      passRate: body.passRate ?? 0,
      duration: body.duration ?? 0,
      status: body.status ?? "completed",
      summary: body.summary ?? "",
    };
    saveRun(record);
    return NextResponse.json({ ok: true, id: record.id });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
