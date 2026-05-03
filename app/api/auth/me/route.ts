import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import prisma from "@/lib/db/client";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ user: null });

  const user = await prisma.user.findUnique({
    where: { id: session.id },
    select: {
      id: true, email: true, name: true, avatar: true, createdAt: true,
      teamMemberships: {
        include: { team: { select: { id: true, name: true, slug: true, plan: true } } },
      },
    },
  });
  return NextResponse.json({ user });
}
