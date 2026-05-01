/**
 * GET    /api/boards/[boardId]  — 보드 상세 (이슈 포함)
 * PATCH  /api/boards/[boardId]  — 보드 수정
 * DELETE /api/boards/[boardId]  — 보드 삭제
 */
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db/client";

export async function GET(_req: NextRequest, { params }: { params: { boardId: string } }) {
  const board = await prisma.qABoard.findUnique({
    where: { id: params.boardId },
    include: {
      issues: { orderBy: { createdAt: "desc" }, include: { _count: { select: { comments: true } } } },
      shareLinks: true,
    },
  });
  if (!board) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ board });
}

export async function PATCH(req: NextRequest, { params }: { params: { boardId: string } }) {
  const body = await req.json();
  const board = await prisma.qABoard.update({
    where: { id: params.boardId },
    data: { name: body.name, description: body.description, targetUrl: body.targetUrl },
  });
  return NextResponse.json({ board });
}

export async function DELETE(_req: NextRequest, { params }: { params: { boardId: string } }) {
  await prisma.qABoard.delete({ where: { id: params.boardId } });
  return NextResponse.json({ ok: true });
}
