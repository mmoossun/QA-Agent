import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db/client";
import { parseFigmaUrl, testFigmaConnection } from "@/lib/integrations/figma";
import { testGithubConnection } from "@/lib/integrations/github";

export async function GET(_req: NextRequest, { params }: { params: { boardId: string } }) {
  const board = await prisma.qABoard.findUnique({
    where: { id: params.boardId },
    select: {
      figmaFileKey: true, figmaFileUrl: true, figmaToken: true,
      githubOwner: true, githubRepo: true, githubToken: true,
    },
  });
  if (!board) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({
    figmaFileKey:  board.figmaFileKey,
    figmaFileUrl:  board.figmaFileUrl,
    hasFigmaToken: !!(board as Record<string, unknown>).figmaToken,
    githubOwner:   board.githubOwner,
    githubRepo:    board.githubRepo,
    hasGithubToken: !!board.githubToken,
  });
}

async function updateSettings(req: NextRequest, { params }: { params: { boardId: string } }) {
  const body = await req.json();
  const update: Record<string, string | null> = {};

  // Figma 설정
  if ("figmaFileUrl" in body) {
    const url = body.figmaFileUrl as string | null;
    if (url) {
      const parsed = parseFigmaUrl(url);
      update.figmaFileUrl = url;
      update.figmaFileKey = parsed?.fileKey ?? null;
    } else {
      update.figmaFileUrl = null;
      update.figmaFileKey = null;
    }
  }
  if ("figmaToken" in body) update.figmaToken = body.figmaToken || null;

  // GitHub 설정
  if ("githubOwner"  in body) update.githubOwner  = body.githubOwner  || null;
  if ("githubRepo"   in body) update.githubRepo   = body.githubRepo   || null;
  if ("githubToken"  in body) update.githubToken  = body.githubToken  || null;

  const board = await prisma.qABoard.update({
    where: { id: params.boardId },
    data: update,
  });
  return NextResponse.json({ ok: true, board });
}

// PUT과 PATCH 모두 동일한 핸들러 사용
export { updateSettings as PUT, updateSettings as PATCH };

// 연결 테스트
export async function POST(req: NextRequest, { params }: { params: { boardId: string } }) {
  const { action } = await req.json();

  if (action === "test-figma") {
    const board = await prisma.qABoard.findUnique({
      where: { id: params.boardId },
      select: { figmaToken: true },
    });
    const result = await testFigmaConnection(board?.figmaToken);
    return NextResponse.json(result);
  }

  if (action === "test-github") {
    const board = await prisma.qABoard.findUnique({
      where: { id: params.boardId },
      select: { githubOwner: true, githubRepo: true, githubToken: true },
    });
    if (!board?.githubOwner || !board.githubRepo || !board.githubToken) {
      return NextResponse.json({ ok: false, error: "GitHub 정보를 먼저 저장하세요" });
    }
    const result = await testGithubConnection({
      owner: board.githubOwner, repo: board.githubRepo, token: board.githubToken,
    });
    return NextResponse.json(result);
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
