/**
 * GET /api/runs
 * Returns recent QA run history for the dashboard
 */

import { NextRequest, NextResponse } from "next/server";
import { loadRuns } from "@/lib/db/history";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const limit = Math.min(Number(searchParams.get("limit") ?? 50), 200);

  const runs = loadRuns().slice(0, limit);
  return NextResponse.json({ runs });
}
