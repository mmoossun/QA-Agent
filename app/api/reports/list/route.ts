import { NextResponse } from "next/server";
import { loadReportsAsync } from "@/lib/db/reports";

export async function GET() {
  const reports = await loadReportsAsync();
  return NextResponse.json({
    reports: reports.map(r => ({
      id: r.id,
      name: r.name,
      targetUrl: r.targetUrl,
      status: r.status,
      riskLevel: r.riskLevel,
      passRate: r.passRate,
      savedAt: r.savedAt,
      findingCount: r.findings?.length ?? 0,
      findings: r.findings ?? [],
    })),
  });
}
