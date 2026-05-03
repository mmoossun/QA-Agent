import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db/client";
import { getFigmaFileFrames } from "@/lib/integrations/figma";

export async function GET(_req: NextRequest, { params }: { params: { boardId: string } }) {
  const board = await prisma.qABoard.findUnique({
    where: { id: params.boardId },
    select: { figmaFileKey: true, figmaToken: true, figmaFileUrl: true },
  });

  if (!board?.figmaFileKey) {
    return NextResponse.json({ error: "Figma 파일이 연동되지 않았습니다. 보드 설정에서 Figma URL을 먼저 등록하세요." }, { status: 400 });
  }

  const pages = await getFigmaFileFrames(board.figmaFileKey, board.figmaToken);

  if (pages.length === 0) {
    return NextResponse.json({ error: "Figma 파일에서 프레임을 불러올 수 없습니다. 토큰과 파일 URL을 확인하세요." }, { status: 502 });
  }

  return NextResponse.json({ pages, fileKey: board.figmaFileKey });
}
