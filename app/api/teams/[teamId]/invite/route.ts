import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db/client";
import { getSession } from "@/lib/auth";

type P = { params: { teamId: string } };

// 초대 링크 생성
export async function POST(req: NextRequest, { params }: P) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { email, role } = await req.json();
  const expiresAt = new Date(Date.now() + 7 * 86_400_000); // 7일

  const invite = await prisma.teamInvite.create({
    data: { teamId: params.teamId, email, role: role ?? "member", expiresAt },
    include: { team: { select: { name: true } } },
  });

  const inviteUrl = `${process.env.NEXT_PUBLIC_APP_URL}/invite/${invite.token}`;
  return NextResponse.json({ invite, inviteUrl }, { status: 201 });
}

export async function GET(_req: NextRequest, { params }: P) {
  const invites = await prisma.teamInvite.findMany({
    where: { teamId: params.teamId, acceptedAt: null },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ invites });
}
