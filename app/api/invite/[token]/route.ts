import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db/client";

export async function GET(_req: NextRequest, { params }: { params: { token: string } }) {
  const invite = await prisma.teamInvite.findUnique({
    where: { token: params.token },
    include: { team: { select: { name: true } } },
  });
  if (!invite) return NextResponse.json({ error: "유효하지 않은 초대 링크입니다." }, { status: 404 });
  if (invite.expiresAt < new Date()) return NextResponse.json({ error: "만료된 초대 링크입니다." }, { status: 410 });
  if (invite.acceptedAt) return NextResponse.json({ error: "이미 사용된 초대 링크입니다." }, { status: 409 });

  return NextResponse.json({ team: invite.team.name, email: invite.email, role: invite.role });
}
