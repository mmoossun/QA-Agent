import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/db/client";

const CreateSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().optional(),
  targetUrl: z.string().optional(),
  boardKey: z.string().min(1).max(6).default("QA").transform(s => s.toUpperCase()),
  projectId: z.string().optional(),
});

export async function GET() {
  const boards = await prisma.qABoard.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { issues: true } },
      shareLinks: {
        select: { id: true, publicToken: true, label: true, viewCount: true, createdAt: true },
        orderBy: { createdAt: "desc" },
      },
    },
  });
  // 민감 정보(토큰) 제외하고 연동 상태만 노출
  const safe = boards.map(b => ({
    ...b,
    githubToken: undefined,
    hasGithubToken: !!b.githubToken,
  }));
  return NextResponse.json({ boards: safe });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const data = CreateSchema.parse(body);
    const board = await prisma.qABoard.create({
      data: {
        name: data.name,
        description: data.description,
        targetUrl: data.targetUrl,
        boardKey: data.boardKey,
        projectId: data.projectId,
      },
      include: {
        _count: { select: { issues: true } },
        shareLinks: true,
      },
    });
    return NextResponse.json({ board }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 });
  }
}
