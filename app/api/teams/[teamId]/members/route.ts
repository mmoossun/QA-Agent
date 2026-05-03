import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db/client";
import { getSession } from "@/lib/auth";

type P = { params: { teamId: string } };

export async function GET(_req: NextRequest, { params }: P) {
  const members = await prisma.teamMember.findMany({
    where: { teamId: params.teamId },
    include: { user: { select: { id: true, name: true, email: true, avatar: true } } },
    orderBy: { joinedAt: "asc" },
  });
  return NextResponse.json({ members });
}

export async function PATCH(req: NextRequest, { params }: P) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { userId, role } = await req.json();
  const member = await prisma.teamMember.updateMany({
    where: { teamId: params.teamId, userId },
    data: { role },
  });
  return NextResponse.json({ ok: member.count > 0 });
}

export async function DELETE(req: NextRequest, { params }: P) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { userId } = await req.json();
  await prisma.teamMember.deleteMany({ where: { teamId: params.teamId, userId } });
  return NextResponse.json({ ok: true });
}
