import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db/client";

type Params = { params: { boardId: string; issueId: string } };

export async function GET(_req: NextRequest, { params }: Params) {
  const links = await prisma.issueLink.findMany({
    where: { OR: [{ fromId: params.issueId }, { toId: params.issueId }] },
    include: {
      from: { select: { id: true, issueKey: true, title: true, status: true, priority: true } },
      to:   { select: { id: true, issueKey: true, title: true, status: true, priority: true } },
    },
  });
  return NextResponse.json({ links });
}

export async function POST(req: NextRequest, { params }: Params) {
  const { linkType, targetIssueId } = await req.json();
  const link = await prisma.issueLink.create({
    data: { linkType, fromId: params.issueId, toId: targetIssueId },
    include: {
      from: { select: { id: true, issueKey: true, title: true, status: true, priority: true } },
      to:   { select: { id: true, issueKey: true, title: true, status: true, priority: true } },
    },
  });
  return NextResponse.json({ link }, { status: 201 });
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const { linkId } = await req.json();
  await prisma.issueLink.delete({ where: { id: linkId } });
  return NextResponse.json({ ok: true });
}
