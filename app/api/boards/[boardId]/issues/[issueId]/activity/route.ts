import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db/client";

type Params = { params: { boardId: string; issueId: string } };

export async function GET(_req: NextRequest, { params }: Params) {
  const [comments, history] = await Promise.all([
    prisma.issueComment.findMany({ where: { issueId: params.issueId }, orderBy: { createdAt: "asc" } }),
    prisma.issueHistory.findMany({ where: { issueId: params.issueId }, orderBy: { createdAt: "asc" } }),
  ]);

  // 댓글 + 이력을 시간순 통합
  const activity = [
    ...comments.map(c => ({ ...c, kind: "comment" as const })),
    ...history.map(h => ({ ...h, kind: "history" as const })),
  ].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  return NextResponse.json({ activity, comments, history });
}
