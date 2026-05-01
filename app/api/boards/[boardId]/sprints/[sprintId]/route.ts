import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db/client";

type Params = { params: { boardId: string; sprintId: string } };

export async function PATCH(req: NextRequest, { params }: Params) {
  const body = await req.json();
  const sprint = await prisma.sprint.update({
    where: { id: params.sprintId },
    data: {
      name: body.name,
      goal: body.goal,
      status: body.status,
      startDate: body.startDate ? new Date(body.startDate) : undefined,
      endDate: body.endDate ? new Date(body.endDate) : undefined,
    },
  });
  return NextResponse.json({ sprint });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  // 스프린트 삭제 시 이슈는 backlog로 이동
  await prisma.issue.updateMany({ where: { sprintId: params.sprintId }, data: { sprintId: null } });
  await prisma.sprint.delete({ where: { id: params.sprintId } });
  return NextResponse.json({ ok: true });
}
