/**
 * Google Sheets API routes
 *
 * GET  /api/google-sheets?sheetId=xxx&tab=TestCases  — read test cases
 * POST /api/google-sheets                             — append test cases
 * PUT  /api/google-sheets                             — full overwrite
 * PATCH /api/google-sheets                            — update single row status
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  readSheet,
  appendTestCases,
  writeAllTestCases,
  updateTestCaseStatus,
  getSheetTabs,
  getRawHeaders,
  type TestCase,
} from "@/lib/google-sheets";

// ── GET: read test cases from sheet (or list tabs) ───────────
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const sheetId = searchParams.get("sheetId");
  const tab = searchParams.get("tab") ?? undefined;
  const tabsOnly = searchParams.get("tabs") === "1";
  const headersOnly = searchParams.get("headers") === "1";

  if (!sheetId) {
    return NextResponse.json({ error: "sheetId is required" }, { status: 400 });
  }

  try {
    if (tabsOnly) {
      const tabs = await getSheetTabs(sheetId);
      return NextResponse.json({ tabs });
    }
    if (headersOnly) {
      const headers = await getRawHeaders(sheetId, tab);
      return NextResponse.json({ headers });
    }
    const testCases = await readSheet(sheetId, tab);
    return NextResponse.json({ testCases });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// ── POST: append new test cases ───────────────────────────────
const AppendSchema = z.object({
  sheetId: z.string().min(1),
  tab: z.string().optional(),
  testCases: z.array(z.object({
    id: z.string(),
    category: z.string(),
    title: z.string(),
    steps: z.string(),
    expectedResult: z.string(),
    priority: z.enum(["High", "Medium", "Low"]),
    status: z.enum(["Not Run", "Pass", "Fail", "Skip"]).default("Not Run"),
    notes: z.string().default(""),
  })),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = AppendSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }
    const { sheetId, tab, testCases } = parsed.data;
    const count = await appendTestCases(sheetId, testCases as TestCase[], tab);
    return NextResponse.json({ success: true, appended: count });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// ── PUT: overwrite all test cases ─────────────────────────────
export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = AppendSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }
    const { sheetId, tab, testCases } = parsed.data;
    await writeAllTestCases(sheetId, testCases as TestCase[], tab);
    return NextResponse.json({ success: true, written: testCases.length });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// ── PATCH: update status of a single test case ────────────────
const PatchSchema = z.object({
  sheetId: z.string().min(1),
  tab: z.string().optional(),
  testCaseId: z.string().min(1),
  status: z.enum(["Not Run", "Pass", "Fail", "Skip"]),
  notes: z.string().default(""),
});

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = PatchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }
    const { sheetId, tab, testCaseId, status, notes } = parsed.data;
    const updated = await updateTestCaseStatus(sheetId, testCaseId, status, notes, tab);
    if (!updated) {
      return NextResponse.json({ error: `Test case ${testCaseId} not found` }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
