/**
 * POST /api/boards/[boardId]/issues/import
 * SavedReport findings → Issue 일괄 생성
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/db/client";

const SEV_MAP: Record<string, string> = {
  critical: "critical", high: "major", medium: "minor", low: "trivial",
};

const Schema = z.object({
  findings: z.array(z.object({
    title: z.string(),
    description: z.string().optional().default(""),
    severity: z.string().optional().default("minor"),
    rootCause: z.string().optional().default(""),
    reproductionSteps: z.string().optional().default(""),
    recommendation: z.string().optional().default(""),
    screenshotPath: z.string().optional(),
    targetUrl: z.string().optional(),
  })),
});

export async function POST(req: NextRequest, { params }: { params: { boardId: string } }) {
  try {
    const body = await req.json();
    const { findings } = Schema.parse(body);
    const created = await prisma.$transaction(
      findings.map(f =>
        prisma.issue.create({
          data: {
            boardId: params.boardId,
            title: f.title,
            description: [f.description, f.rootCause ? `원인: ${f.rootCause}` : ""].filter(Boolean).join("\n\n"),
            severity: SEV_MAP[f.severity] ?? "minor",
            type: "bug",
            status: "open",
            source: "agent",
            stepToReproduce: f.reproductionSteps || undefined,
            expectedResult: f.recommendation ? `권장 조치: ${f.recommendation}` : undefined,
            screenshotUrl: f.screenshotPath || undefined,
            targetUrl: f.targetUrl || undefined,
          },
        })
      )
    );
    return NextResponse.json({ created: created.length }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 });
  }
}
