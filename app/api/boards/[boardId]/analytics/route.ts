import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db/client";

export async function GET(_req: NextRequest, { params }: { params: { boardId: string } }) {
  const issues = await prisma.issue.findMany({
    where: { boardId: params.boardId },
    select: { id: true, status: true, priority: true, type: true, storyPoints: true, assignee: true, createdAt: true, resolvedAt: true, updatedAt: true, sprintId: true, epicName: true },
  });

  const sprints = await prisma.sprint.findMany({
    where: { boardId: params.boardId },
    include: { issues: { select: { id: true, status: true, storyPoints: true } } },
    orderBy: { createdAt: "asc" },
  });

  // 이슈 분포
  const byStatus   = groupBy(issues, i => i.status);
  const byPriority = groupBy(issues, i => i.priority);
  const byType     = groupBy(issues, i => i.type);
  const byAssignee = groupBy(issues.filter(i => i.assignee), i => i.assignee!);

  // 완료율
  const total    = issues.length;
  const done     = issues.filter(i => i.status === "done").length;
  const doneRate = total > 0 ? Math.round(done / total * 100) : 0;

  // 평균 사이클 타임 (생성 → 완료, 단위: 시간)
  const resolved = issues.filter(i => i.resolvedAt);
  const avgCycle = resolved.length > 0
    ? Math.round(resolved.reduce((s, i) => s + (new Date(i.resolvedAt!).getTime() - new Date(i.createdAt).getTime()), 0) / resolved.length / 3_600_000)
    : 0;

  // 스프린트 속도 (완료된 스프린트 기준 SP)
  const sprintVelocity = sprints
    .filter(s => s.status === "completed")
    .map(s => ({
      name: s.name,
      total: s.issues.reduce((sum, i) => sum + (i.storyPoints ?? 0), 0),
      done: s.issues.filter(i => i.status === "done").reduce((sum, i) => sum + (i.storyPoints ?? 0), 0),
    }));

  // 최근 7일 이슈 생성 추이
  const now = Date.now();
  const trend = Array.from({ length: 7 }, (_, i) => {
    const dayStart = new Date(now - (6 - i) * 86_400_000); dayStart.setHours(0, 0, 0, 0);
    const dayEnd   = new Date(now - (6 - i) * 86_400_000); dayEnd.setHours(23, 59, 59, 999);
    return {
      date: dayStart.toLocaleDateString("ko-KR", { month: "short", day: "numeric" }),
      created: issues.filter(i => new Date(i.createdAt) >= dayStart && new Date(i.createdAt) <= dayEnd).length,
      resolved: issues.filter(i => i.resolvedAt && new Date(i.resolvedAt) >= dayStart && new Date(i.resolvedAt) <= dayEnd).length,
    };
  });

  return NextResponse.json({
    summary: { total, done, doneRate, avgCycleHours: avgCycle, totalPoints: issues.reduce((s, i) => s + (i.storyPoints ?? 0), 0), donePoints: issues.filter(i => i.status === "done").reduce((s, i) => s + (i.storyPoints ?? 0), 0) },
    byStatus, byPriority, byType, byAssignee,
    sprintVelocity, trend,
  });
}

function groupBy<T>(arr: T[], key: (i: T) => string): Record<string, number> {
  return arr.reduce((acc, item) => { const k = key(item); acc[k] = (acc[k] ?? 0) + 1; return acc; }, {} as Record<string, number>);
}
