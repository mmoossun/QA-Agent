import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db/client";

export async function GET(_req: NextRequest, { params }: { params: { boardId: string } }) {
  const board = await prisma.qABoard.findUnique({ where: { id: params.boardId }, select: { name: true } });
  const issues = await prisma.issue.findMany({
    where: { boardId: params.boardId },
    orderBy: { createdAt: "desc" },
  });

  const headers = ["키", "제목", "유형", "우선순위", "상태", "담당자", "보고자", "에픽", "스토리포인트", "환경", "재현단계", "기대결과", "실제결과", "URL", "생성일", "완료일"];

  const rows = issues.map(i => [
    i.issueKey ?? "",
    i.title,
    i.type,
    i.priority,
    i.status,
    i.assignee ?? "",
    i.reporter ?? "",
    i.epicName ?? "",
    i.storyPoints?.toString() ?? "",
    i.environment ?? "",
    i.stepToReproduce ?? "",
    i.expectedResult ?? "",
    i.actualResult ?? "",
    i.targetUrl ?? "",
    new Date(i.createdAt).toLocaleString("ko-KR"),
    i.resolvedAt ? new Date(i.resolvedAt).toLocaleString("ko-KR") : "",
  ]);

  const csv = [headers, ...rows]
    .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(","))
    .join("\n");

  const filename = `${board?.name ?? "qa-board"}-${new Date().toISOString().slice(0, 10)}.csv`;

  return new Response("﻿" + csv, { // BOM for Excel 한글 지원
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  });
}
