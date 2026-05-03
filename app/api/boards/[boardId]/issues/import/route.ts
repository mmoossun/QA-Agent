import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/db/client";

const SEV_MAP: Record<string, string> = {
  critical: "critical", high: "high", medium: "medium", low: "low",
  major: "high", minor: "medium", trivial: "low",
};

const Schema = z.object({
  findings: z.array(z.object({
    title: z.string(),
    description: z.string().optional().default(""),
    severity: z.string().optional().default("medium"),
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

    // issueKey를 위해 카운터를 findings 수만큼 한번에 증가
    const board = await prisma.qABoard.update({
      where: { id: params.boardId },
      data: { issueCounter: { increment: findings.length } },
      select: { boardKey: true, issueCounter: true },
    });

    // 마지막 카운터 값 기준으로 역산하여 각 finding에 key 부여
    const startCounter = board.issueCounter - findings.length + 1;

    const created = await prisma.$transaction(
      findings.map((f, i) =>
        prisma.issue.create({
          data: {
            boardId: params.boardId,
            issueKey: `${board.boardKey}-${startCounter + i}`,
            title: f.title,
            description: [f.description, f.rootCause ? `원인: ${f.rootCause}` : ""].filter(Boolean).join("\n\n") || undefined,
            priority: SEV_MAP[f.severity] ?? "medium",
            type: "bug",
            status: "todo",
            source: "agent",
            stepToReproduce: f.reproductionSteps || undefined,
            expectedResult: f.recommendation ? `권장 조치: ${f.recommendation}` : undefined,
            screenshotUrl: f.screenshotPath || undefined,
            targetUrl: f.targetUrl || undefined,
          },
        })
      )
    );
    return NextResponse.json({ created: created.length, keys: created.map(i => i.issueKey) }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 });
  }
}
