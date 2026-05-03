/**
 * GET /api/share/[token]  — 공개 토큰으로 보드 데이터 조회 (인증 불필요)
 */
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db/client";

export async function GET(_req: NextRequest, { params }: { params: { token: string } }) {
  const link = await prisma.sharedBoard.findUnique({
    where: { publicToken: params.token },
    include: {
      board: {
        include: {
          issues: {
            orderBy: { createdAt: "desc" },
            include: { _count: { select: { comments: true } } },
          },
        },
      },
    },
  });

  if (!link) {
    return NextResponse.json({ error: "링크를 찾을 수 없습니다." }, { status: 404 });
  }

  if (link.expiresAt && link.expiresAt < new Date()) {
    return NextResponse.json({ error: "만료된 링크입니다." }, { status: 410 });
  }

  // 조회수 증가 (비동기, 응답 지연 없이)
  prisma.sharedBoard.update({
    where: { id: link.id },
    data: { viewCount: { increment: 1 } },
  }).catch(() => {});

  const { board } = link;
  const issues = board.issues;
  const total = issues.length;
  const resolved = issues.filter(i => i.status === "done").length;
  const criticalOpen = issues.filter(i => i.priority === "critical" && i.status !== "done").length;

  return NextResponse.json({
    token: link.publicToken,
    label: link.label,
    viewCount: link.viewCount + 1,
    board: {
      id: board.id,
      name: board.name,
      description: board.description,
      targetUrl: board.targetUrl,
    },
    stats: { total, resolved, criticalOpen, resolveRate: total > 0 ? Math.round(resolved / total * 100) : 0 },
    issues: issues.map(i => ({
      id: i.id,
      title: i.title,
      description: i.description,
      type: i.type,
      priority: i.priority,
      status: i.status,
      screenshotUrl: i.screenshotUrl,
      targetUrl: i.targetUrl,
      stepToReproduce: i.stepToReproduce,
      expectedResult: i.expectedResult,
      actualResult: i.actualResult,
      tags: i.tags ? JSON.parse(i.tags) : [],
      commentCount: i._count.comments,
      createdAt: i.createdAt,
      updatedAt: i.updatedAt,
    })),
  });
}
