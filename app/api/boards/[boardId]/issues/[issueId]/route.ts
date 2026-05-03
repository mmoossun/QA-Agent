import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db/client";
import { sseEmit } from "@/lib/sse";
import { notifySlack } from "@/lib/integrations/slack";

type Params = { params: { boardId: string; issueId: string } };

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const body = await req.json();
    const existing = await prisma.issue.findUnique({ where: { id: params.issueId } });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const updateData: Record<string, unknown> = {};

    // 이력 추적 필드
    for (const field of ["status", "priority", "type", "assignee"] as const) {
      if (body[field] !== undefined && body[field] !== existing[field]) {
        updateData[field] = body[field];
        await prisma.issueHistory.create({
          data: {
            issueId: params.issueId,
            field,
            oldValue: existing[field] ?? "",
            newValue: String(body[field]),
          },
        });
      }
    }

    // 일반 수정 필드
    for (const f of ["title", "description", "stepToReproduce", "expectedResult", "actualResult", "screenshotUrl", "targetUrl", "environment", "reporter", "epicName", "storyPoints", "sprintId", "rank"]) {
      if (body[f] !== undefined) updateData[f] = body[f];
    }
    if (body.dueDate !== undefined) {
      updateData.dueDate = body.dueDate ? new Date(body.dueDate) : null;
    }

    if (body.tags !== undefined) updateData.tags = JSON.stringify(body.tags);

    if (body.status === "done" && existing.status !== "done") {
      updateData.resolvedAt = new Date();
    } else if (body.status && body.status !== "done") {
      updateData.resolvedAt = null;
    }

    const issue = await prisma.issue.update({
      where: { id: params.issueId },
      data: updateData,
      include: { _count: { select: { comments: true } } },
    });

    // SSE 실시간 브로드캐스트
    sseEmit(params.boardId, "issue_updated", issue);

    // Slack 알림 (상태 변경 시)
    if (updateData.status && existing.status !== updateData.status) {
      const stLabel: Record<string, string> = { todo: "할 일", in_progress: "진행 중", in_review: "검토 중", done: "완료", wont_fix: "해결 안 함" };
      notifySlack(params.boardId,
        `*${issue.issueKey}* 상태 변경: ${stLabel[existing.status]} → ${stLabel[String(updateData.status)]}`,
        [{ title: "이슈", value: issue.title }, { title: "담당자", value: issue.assignee ?? "미배정" }]
      );
    }

    return NextResponse.json({ issue });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 });
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  await prisma.issue.delete({ where: { id: params.issueId } });
  sseEmit(params.boardId, "issue_deleted", { id: params.issueId });
  return NextResponse.json({ ok: true });
}
