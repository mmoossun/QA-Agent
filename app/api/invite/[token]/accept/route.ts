import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db/client";
import { getSession } from "@/lib/auth";

export async function POST(_req: NextRequest, { params }: { params: { token: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "먼저 로그인하세요." }, { status: 401 });

  const invite = await prisma.teamInvite.findUnique({ where: { token: params.token } });
  if (!invite || invite.acceptedAt || invite.expiresAt < new Date()) {
    return NextResponse.json({ error: "유효하지 않거나 만료된 초대입니다." }, { status: 400 });
  }

  // 이미 멤버인지 확인
  const already = await prisma.teamMember.findUnique({
    where: { userId_teamId: { userId: session.id, teamId: invite.teamId } },
  });
  if (!already) {
    await prisma.teamMember.create({ data: { userId: session.id, teamId: invite.teamId, role: invite.role } });
  }
  await prisma.teamInvite.update({ where: { id: invite.id }, data: { acceptedAt: new Date() } });

  return NextResponse.json({ ok: true });
}
