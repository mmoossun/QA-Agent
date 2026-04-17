/**
 * GET  /api/memory?q=...&limit=5    — semantic search over past test runs
 * GET  /api/memory                  — list all (no embedding, latest first)
 * DELETE /api/memory?id=...         — remove a record
 */

import { NextRequest, NextResponse } from "next/server";
import { searchSimilarTests, loadAllTests } from "@/lib/memory/test-store";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.trim();
  const limit = Math.min(Number(searchParams.get("limit") ?? 20), 100);

  if (q) {
    const results = await searchSimilarTests(q, limit);
    return NextResponse.json({
      results: results.map(r => ({ ...r, embedding: undefined })),
    });
  }

  const all = loadAllTests(limit).map(r => ({ ...r, embedding: undefined }));
  return NextResponse.json({ results: all });
}
