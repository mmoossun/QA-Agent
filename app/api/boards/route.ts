/**
 * GET  /api/boards        — 전체 보드 목록
 * POST /api/boards        — 보드 생성
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/db/client";

const CreateSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().optional(),
  targetUrl: z.string().url().optional(),
  projectId: z.string().optional(),
});

export async function GET() {
  const boards = await prisma.qABoard.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { issues: true } },
      shareLinks: { select: { id: true, publicToken: true, label: true, expiresAt: true, viewCount: true, createdAt: true } },
    },
  });
  return NextResponse.json({ boards });
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
        projectId: data.projectId,
      },
    });
    return NextResponse.json({ board }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 });
  }
}
