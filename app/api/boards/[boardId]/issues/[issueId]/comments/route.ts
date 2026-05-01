import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db/client";

type Params = { params: { boardId: string; issueId: string } };

export async function GET(_req: NextRequest, { params }: Params) {
  const comments = await prisma.issueComment.findMany({
    where: { issueId: params.issueId },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json({ comments });
}

export async function POST(req: NextRequest, { params }: Params) {
  const { content, authorName } = await req.json();
  if (!content?.trim()) return NextResponse.json({ error: "내용 필요" }, { status: 400 });
  const comment = await prisma.issueComment.create({
    data: { issueId: params.issueId, content: content.trim(), authorName: authorName?.trim() || "익명" },
  });
  return NextResponse.json({ comment }, { status: 201 });
}
