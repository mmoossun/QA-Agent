/**
 * POST /api/reports/save   — save a TestReport (from human-agent page)
 * GET  /api/reports/save   — list all saved reports (without steps to keep payload small)
 * DELETE /api/reports/save?id=... — delete a report
 */

import { NextRequest, NextResponse } from "next/server";
import { saveReport, loadReports, deleteReport } from "@/lib/db/reports";

export async function POST(req: NextRequest) {
  try {
    const { report, name } = await req.json();
    if (!report?.id) return NextResponse.json({ error: "report.id required" }, { status: 400 });
    const saved = saveReport(report, name);
    return NextResponse.json({ ok: true, id: saved.id, savedAt: saved.savedAt });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const id = new URL(req.url).searchParams.get("id");

  // Single report with full steps (for detail view)
  if (id) {
    const report = loadReports().find(r => r.id === id);
    if (!report) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ report });
  }

  // List without steps — keep payload light
  const reports = loadReports().map(r => ({
    id: r.id,
    name: r.name,
    savedAt: r.savedAt,
    createdAt: r.createdAt,
    targetUrl: r.targetUrl,
    goal: r.goal,
    status: r.status,
    riskLevel: r.riskLevel,
    passRate: r.passRate,
    stepCount: r.stepCount,
    totalDurationMs: r.totalDurationMs,
    executiveSummary: r.executiveSummary,
    findings: r.findings,
    recommendations: r.recommendations,
    testedFeatures: r.testedFeatures,
  }));
  return NextResponse.json({ reports });
}

export async function DELETE(req: NextRequest) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const ok = deleteReport(id);
  return NextResponse.json({ ok });
}
