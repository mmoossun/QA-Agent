/**
 * Persistent report store — backed by Prisma/SQLite (dev.db)
 * Replaces the old file-based data/saved-reports.json approach.
 */

import { prisma } from "@/lib/db/client";
import type { TestReport } from "@/lib/human-agent/report-generator";

export interface SavedReport extends TestReport {
  savedAt: string;
  name: string;
}

const MAX = 200;

import type { SavedReport as PrismaReportRow } from "@prisma/client";

function toRow(r: SavedReport) {
  return {
    id: r.id,
    name: r.name,
    savedAt: new Date(r.savedAt),
    createdAt: r.createdAt,
    targetUrl: r.targetUrl,
    goal: r.goal ?? "",
    status: r.status,
    riskLevel: r.riskLevel,
    passRate: r.passRate,
    stepCount: r.stepCount,
    totalDurationMs: r.totalDurationMs,
    executiveSummary: r.executiveSummary ?? "",
    findings: JSON.stringify(r.findings ?? []),
    recommendations: JSON.stringify(r.recommendations ?? []),
    testedFeatures: JSON.stringify(r.testedFeatures ?? []),
    steps: JSON.stringify(r.steps ?? []),
  };
}

function fromRow(row: PrismaReportRow): SavedReport {
  return {
    id: row.id,
    name: row.name,
    savedAt: row.savedAt.toISOString(),
    createdAt: row.createdAt,
    targetUrl: row.targetUrl,
    goal: row.goal,
    status: row.status as SavedReport["status"],
    riskLevel: row.riskLevel as SavedReport["riskLevel"],
    passRate: row.passRate,
    stepCount: row.stepCount,
    totalDurationMs: row.totalDurationMs,
    executiveSummary: row.executiveSummary,
    findings: JSON.parse(row.findings),
    recommendations: JSON.parse(row.recommendations),
    testedFeatures: JSON.parse(row.testedFeatures),
    steps: JSON.parse(row.steps),
  };
}

export async function loadReportsAsync(): Promise<SavedReport[]> {
  try {
    const rows = await prisma.savedReport.findMany({
      orderBy: { savedAt: "desc" },
      take: MAX,
    });
    return rows.map(fromRow);
  } catch { return []; }
}

export async function saveReportAsync(report: TestReport, name?: string): Promise<SavedReport> {
  const saved: SavedReport = {
    ...report,
    savedAt: new Date().toISOString(),
    name: name ?? `${new Date().toLocaleDateString("ko-KR")} — ${report.targetUrl}`,
  };

  await prisma.savedReport.upsert({
    where: { id: saved.id },
    update: toRow(saved),
    create: toRow(saved),
  });

  // Trim to MAX
  const old = await prisma.savedReport.findMany({
    orderBy: { savedAt: "desc" },
    skip: MAX,
    select: { id: true },
  });
  if (old.length > 0) {
    await prisma.savedReport.deleteMany({ where: { id: { in: old.map(r => r.id) } } });
  }

  return saved;
}

export async function deleteReportAsync(id: string): Promise<boolean> {
  try {
    await prisma.savedReport.delete({ where: { id } });
    return true;
  } catch { return false; }
}

export async function getReportAsync(id: string): Promise<SavedReport | null> {
  try {
    const row = await prisma.savedReport.findUnique({ where: { id } });
    return row ? fromRow(row) : null;
  } catch { return null; }
}
