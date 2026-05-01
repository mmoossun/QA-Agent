import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db/client";

export async function GET(_req: NextRequest, { params }: { params: { boardId: string } }) {
  const sprints = await prisma.sprint.findMany({
    where: { boardId: params.boardId },
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { issues: true } } },
  });
  return NextResponse.json({ sprints });
}

export async function POST(req: NextRequest, { params }: { params: { boardId: string } }) {
  const body = await req.json();
  // 기존 active 스프린트가 있으면 planning 상태만 허용
  const sprint = await prisma.sprint.create({
    data: {
      boardId: params.boardId,
      name: body.name ?? "스프린트 1",
      goal: body.goal,
      status: "planning",
      startDate: body.startDate ? new Date(body.startDate) : undefined,
      endDate: body.endDate ? new Date(body.endDate) : undefined,
    },
  });
  return NextResponse.json({ sprint }, { status: 201 });
}
