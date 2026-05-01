import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/db/client";

const CreateSchema = z.object({
  title: z.string().min(1).max(300),
  description: z.string().optional(),
  type: z.enum(["bug", "task", "story", "improvement", "spec"]).default("bug"),
  priority: z.enum(["critical", "high", "medium", "low"]).default("medium"),
  assignee: z.string().optional(),
  reporter: z.string().optional(),
  epicName: z.string().optional(),
  storyPoints: z.number().int().min(0).max(100).optional(),
  stepToReproduce: z.string().optional(),
  expectedResult: z.string().optional(),
  actualResult: z.string().optional(),
  environment: z.string().optional(),
  screenshotUrl: z.string().optional(),
  targetUrl: z.string().optional(),
  dueDate: z.string().optional(),
  sprintId: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

export async function GET(_req: NextRequest, { params }: { params: { boardId: string } }) {
  const issues = await prisma.issue.findMany({
    where: { boardId: params.boardId },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    include: { _count: { select: { comments: true } } },
  });
  return NextResponse.json({ issues });
}

export async function POST(req: NextRequest, { params }: { params: { boardId: string } }) {
  try {
    const body = await req.json();
    const data = CreateSchema.parse(body);

    // 이슈 키 자동 생성 — boardKey + 증가 카운터
    const board = await prisma.qABoard.update({
      where: { id: params.boardId },
      data: { issueCounter: { increment: 1 } },
      select: { boardKey: true, issueCounter: true },
    });
    const issueKey = `${board.boardKey}-${board.issueCounter}`;

    const issue = await prisma.issue.create({
      data: {
        ...data,
        issueKey,
        tags: data.tags ? JSON.stringify(data.tags) : undefined,
        dueDate: data.dueDate ? new Date(data.dueDate) : undefined,
        boardId: params.boardId,
        source: "web",
        status: "todo",
      },
      include: { _count: { select: { comments: true } } },
    });
    return NextResponse.json({ issue }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 });
  }
}
