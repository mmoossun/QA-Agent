/**
 * GET /api/figma/frame-preview?url={figmaUrl}
 * Figma 프레임 스크린샷 URL 반환 (토큰 서버사이드 처리)
 */
import { NextRequest, NextResponse } from "next/server";
import { parseFigmaUrl, getFigmaFrameImage } from "@/lib/integrations/figma";

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");
  if (!url) return NextResponse.json({ error: "url 파라미터 필요" }, { status: 400 });

  const parsed = parseFigmaUrl(url);
  if (!parsed) return NextResponse.json({ error: "유효하지 않은 Figma URL" }, { status: 400 });
  if (!parsed.nodeId) return NextResponse.json({ error: "node-id가 URL에 없습니다" }, { status: 400 });

  const imageUrl = await getFigmaFrameImage(parsed.fileKey, parsed.nodeId);
  if (!imageUrl) return NextResponse.json({ error: "이미지를 가져올 수 없습니다" }, { status: 404 });

  return NextResponse.json({ imageUrl, fileKey: parsed.fileKey, nodeId: parsed.nodeId });
}
