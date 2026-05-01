import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db/client";

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
    for (const f of ["title", "description", "stepToReproduce", "expectedResult", "actualResult", "screenshotUrl", "targetUrl", "environment", "reporter", "dueDate"]) {
      if (body[f] !== undefined) updateData[f] = body[f];
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
    return NextResponse.json({ issue });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 });
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  await prisma.issue.delete({ where: { id: params.issueId } });
  return NextResponse.json({ ok: true });
}
