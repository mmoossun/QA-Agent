/**
 * GET  /api/boards/[boardId]/share  — 공유 링크 목록
 * POST /api/boards/[boardId]/share  — 공유 링크 생성
 */
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db/client";

export async function GET(_req: NextRequest, { params }: { params: { boardId: string } }) {
  const links = await prisma.sharedBoard.findMany({
    where: { boardId: params.boardId },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ links });
}

export async function POST(req: NextRequest, { params }: { params: { boardId: string } }) {
  try {
    const body = await req.json().catch(() => ({}));
    const { label, expiresDays } = body as { label?: string; expiresDays?: number };

    const expiresAt = expiresDays
      ? new Date(Date.now() + expiresDays * 86_400_000)
      : null;

    const link = await prisma.sharedBoard.create({
      data: {
        boardId: params.boardId,
        label: label ?? null,
        expiresAt: expiresAt ?? undefined,
      },
    });

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    return NextResponse.json({
      link,
      url: `${appUrl}/share/${link.publicToken}`,
    }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 });
  }
}
