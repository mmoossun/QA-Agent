/**
 * GET  /api/boards/[boardId]/issues  — 이슈 목록
 * POST /api/boards/[boardId]/issues  — 이슈 생성
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/db/client";

const CreateSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().optional(),
  type: z.enum(["bug", "design", "content", "accessibility", "spec"]).default("bug"),
  severity: z.enum(["critical", "major", "minor", "trivial"]).default("minor"),
  stepToReproduce: z.string().optional(),
  expectedResult: z.string().optional(),
  actualResult: z.string().optional(),
  screenshotUrl: z.string().optional(),
  targetUrl: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

export async function GET(_req: NextRequest, { params }: { params: { boardId: string } }) {
  const issues = await prisma.issue.findMany({
    where: { boardId: params.boardId },
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { comments: true } } },
  });
  return NextResponse.json({ issues });
}

export async function POST(req: NextRequest, { params }: { params: { boardId: string } }) {
  try {
    const body = await req.json();
    const data = CreateSchema.parse(body);
    const issue = await prisma.issue.create({
      data: {
        ...data,
        tags: data.tags ? JSON.stringify(data.tags) : undefined,
        boardId: params.boardId,
        source: "web",
      },
    });
    return NextResponse.json({ issue }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 });
  }
}
