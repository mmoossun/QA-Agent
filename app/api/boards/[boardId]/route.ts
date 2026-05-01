import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db/client";

const INCLUDE = {
  _count: { select: { issues: true } },
  shareLinks: {
    select: { id: true, publicToken: true, label: true, viewCount: true, createdAt: true },
    orderBy: { createdAt: "desc" as const },
  },
};

export async function GET(_req: NextRequest, { params }: { params: { boardId: string } }) {
  const board = await prisma.qABoard.findUnique({
    where: { id: params.boardId },
    include: { ...INCLUDE, issues: { orderBy: { createdAt: "desc" }, include: { _count: { select: { comments: true } } } } },
  });
  if (!board) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ board });
}

export async function PATCH(req: NextRequest, { params }: { params: { boardId: string } }) {
  const body = await req.json();
  const board = await prisma.qABoard.update({
    where: { id: params.boardId },
    data: {
      name: body.name,
      description: body.description,
      targetUrl: body.targetUrl,
      boardKey: body.boardKey,
    },
    include: INCLUDE,
  });
  return NextResponse.json({ board });
}

export async function DELETE(_req: NextRequest, { params }: { params: { boardId: string } }) {
  await prisma.qABoard.delete({ where: { id: params.boardId } });
  return NextResponse.json({ ok: true });
}
