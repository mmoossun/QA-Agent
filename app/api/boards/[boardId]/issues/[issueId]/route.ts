/**
 * PATCH  /api/boards/[boardId]/issues/[issueId]  — 이슈 수정 (상태 변경 포함)
 * DELETE /api/boards/[boardId]/issues/[issueId]  — 이슈 삭제
 */
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db/client";

type Params = { params: { boardId: string; issueId: string } };

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const body = await req.json();
    const existing = await prisma.issue.findUnique({ where: { id: params.issueId } });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const updateData: Record<string, unknown> = {};
    const trackFields = ["status", "severity", "type"] as const;

    for (const field of trackFields) {
      if (body[field] !== undefined && body[field] !== (existing as Record<string, unknown>)[field]) {
        updateData[field] = body[field];
        // 변경 이력 기록
        await prisma.issueHistory.create({
          data: {
            issueId: params.issueId,
            field,
            oldValue: String((existing as Record<string, unknown>)[field] ?? ""),
            newValue: String(body[field]),
          },
        });
      }
    }

    // 그 외 수정 가능 필드
    for (const f of ["title", "description", "stepToReproduce", "expectedResult", "actualResult", "screenshotUrl", "targetUrl"]) {
      if (body[f] !== undefined) updateData[f] = body[f];
    }

    if (body.status === "resolved" && existing.status !== "resolved") {
      updateData.resolvedAt = new Date();
    }
    if (body.tags !== undefined) {
      updateData.tags = JSON.stringify(body.tags);
    }

    const issue = await prisma.issue.update({ where: { id: params.issueId }, data: updateData });
    return NextResponse.json({ issue });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 });
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  await prisma.issue.delete({ where: { id: params.issueId } });
  return NextResponse.json({ ok: true });
}
