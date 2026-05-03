import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/db/client";
import { getSession } from "@/lib/auth";

const Schema = z.object({
  name: z.string().min(1).max(50),
  slug: z.string().min(2).max(20).regex(/^[a-z0-9-]+$/, "영소문자, 숫자, 하이픈만 사용 가능").optional(),
});

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { name, slug } = Schema.parse(await req.json());
  const finalSlug = slug ?? name.toLowerCase().replace(/[^a-z0-9]/g, "-").replace(/-+/g, "-").slice(0, 20) + "-" + Date.now().toString(36);

  const exists = await prisma.team.findUnique({ where: { slug: finalSlug } });
  if (exists) return NextResponse.json({ error: "이미 사용 중인 슬러그입니다." }, { status: 409 });

  const team = await prisma.team.create({
    data: {
      name, slug: finalSlug,
      members: { create: { userId: session.id, role: "owner" } },
    },
    include: { members: true },
  });
  return NextResponse.json({ team }, { status: 201 });
}

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const memberships = await prisma.teamMember.findMany({
    where: { userId: session.id },
    include: {
      team: {
        include: {
          _count: { select: { members: true, boards: true } },
          members: { include: { user: { select: { id: true, name: true, email: true, avatar: true } } } },
        },
      },
    },
  });
  return NextResponse.json({ teams: memberships.map(m => ({ ...m.team, myRole: m.role })) });
}
