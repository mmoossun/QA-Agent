/**
 * POST /api/boards/[boardId]/issues/[issueId]/push
 * 기존 이슈를 Figma 코멘트 / GitHub 이슈로 수동 등록
 * body: { target: "figma" | "github" }
 */
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db/client";
import { createFigmaComment, buildFigmaCommentBody } from "@/lib/integrations/figma";
import { createGithubIssue } from "@/lib/integrations/github";

type Params = { params: { boardId: string; issueId: string } };

export async function POST(req: NextRequest, { params }: Params) {
  const { target } = await req.json() as { target: "figma" | "github" };

  const [issue, board] = await Promise.all([
    prisma.issue.findUnique({ where: { id: params.issueId } }),
    prisma.qABoard.findUnique({
      where: { id: params.boardId },
      select: {
        figmaFileKey: true, figmaToken: true,
        githubOwner: true, githubRepo: true, githubToken: true,
      },
    }),
  ]);
  if (!issue || !board) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const ext: Record<string, string> = issue.externalIds ? JSON.parse(issue.externalIds) : {};

  // ── Figma ─────────────────────────────────────────────────────
  if (target === "figma") {
    if (ext.figma_comment_id) {
      return NextResponse.json({ error: "이미 Figma 코멘트가 등록되어 있습니다." }, { status: 409 });
    }

    // 이슈 targetUrl에서 파일키/노드ID 파싱, 없으면 보드 파일키 사용
    let fileKey = board.figmaFileKey;
    let nodeId: string | undefined;

    if (issue.targetUrl?.includes("figma.com")) {
      const { parseFigmaUrl } = await import("@/lib/integrations/figma");
      const parsed = parseFigmaUrl(issue.targetUrl);
      if (parsed) { fileKey = parsed.fileKey; nodeId = parsed.nodeId; }
    }

    if (!fileKey) return NextResponse.json({ error: "Figma 파일이 연동되지 않았습니다. 보드 연동 설정을 확인하세요." }, { status: 400 });

    const msg = buildFigmaCommentBody(issue);
    const commentId = await createFigmaComment(fileKey, nodeId, msg, board.figmaToken);
    if (!commentId) return NextResponse.json({ error: "Figma 코멘트 등록에 실패했습니다. 토큰과 파일 URL을 확인하세요." }, { status: 502 });

    await prisma.issue.update({
      where: { id: issue.id },
      data: { externalIds: JSON.stringify({ ...ext, figma_comment_id: commentId, figma_file_key: fileKey }) },
    });
    return NextResponse.json({ ok: true, commentId });
  }

  // ── GitHub ────────────────────────────────────────────────────
  if (target === "github") {
    if (ext.github_issue_number) {
      return NextResponse.json({ error: "이미 GitHub 이슈가 등록되어 있습니다." }, { status: 409 });
    }
    if (!board.githubOwner || !board.githubRepo || !board.githubToken) {
      return NextResponse.json({ error: "GitHub 연동이 설정되지 않았습니다. 보드 연동 설정을 확인하세요." }, { status: 400 });
    }

    const priLabel: Record<string, string> = { critical: "⛔ Critical", high: "🔴 High", medium: "🟡 Medium", low: "🔵 Low" };
    const body = [
      `**이슈 키:** ${issue.issueKey}`,
      `**우선순위:** ${priLabel[issue.priority] ?? issue.priority}`,
      issue.description    ? `\n**설명:**\n${issue.description}` : "",
      issue.stepToReproduce ? `\n**재현 단계:**\n${issue.stepToReproduce}` : "",
      issue.expectedResult  ? `\n**기대 결과:** ${issue.expectedResult}` : "",
      issue.actualResult    ? `\n**실제 결과:** ${issue.actualResult}` : "",
      issue.environment     ? `\n**환경:** ${issue.environment}` : "",
      issue.targetUrl       ? `\n**URL:** ${issue.targetUrl}` : "",
      `\n---\n*QA Board에서 수동으로 등록한 이슈입니다.*`,
    ].filter(Boolean).join("\n");

    const ghNumber = await createGithubIssue(
      { owner: board.githubOwner, repo: board.githubRepo, token: board.githubToken },
      { title: `[${issue.issueKey}] ${issue.title}`, body, labels: ["qa-board", issue.priority] },
    );
    if (!ghNumber) return NextResponse.json({ error: "GitHub 이슈 등록에 실패했습니다. 토큰과 레포를 확인하세요." }, { status: 502 });

    await prisma.issue.update({
      where: { id: issue.id },
      data: { externalIds: JSON.stringify({ ...ext, github_issue_number: ghNumber, github_repo: `${board.githubOwner}/${board.githubRepo}` }) },
    });
    return NextResponse.json({ ok: true, issueNumber: ghNumber, repo: `${board.githubOwner}/${board.githubRepo}` });
  }

  return NextResponse.json({ error: "target must be figma or github" }, { status: 400 });
}
