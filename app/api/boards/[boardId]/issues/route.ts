import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/db/client";
import { sseEmit } from "@/lib/sse";
import { notifySlack } from "@/lib/integrations/slack";
import { createJiraTicket } from "@/lib/integrations/jira";
import { parseFigmaUrl, createFigmaComment, getFigmaFrameImage } from "@/lib/integrations/figma";
import { createGithubIssue } from "@/lib/integrations/github";

const CreateSchema = z.object({
  title: z.string().min(1).max(300),
  description: z.string().optional(),
  type: z.enum(["bug", "task", "story", "improvement", "spec"]).default("bug"),
  priority: z.enum(["critical", "high", "medium", "low"]).default("medium"),
  assignee: z.string().optional(),
  reporter: z.string().optional(),
  epicName: z.string().optional(),
  storyPoints: z.number().int().min(0).max(100).optional(),
  stepToReproduce: z.string().optional(),
  expectedResult: z.string().optional(),
  actualResult: z.string().optional(),
  environment: z.string().optional(),
  screenshotUrl: z.string().optional(),
  targetUrl: z.string().optional(),
  dueDate: z.string().optional(),
  sprintId: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

export async function GET(_req: NextRequest, { params }: { params: { boardId: string } }) {
  const issues = await prisma.issue.findMany({
    where: { boardId: params.boardId },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    include: { _count: { select: { comments: true } } },
  });
  return NextResponse.json({ issues });
}

export async function POST(req: NextRequest, { params }: { params: { boardId: string } }) {
  try {
    const body = await req.json();
    const data = CreateSchema.parse(body);

    // 이슈 키 자동 생성 — boardKey + 증가 카운터
    const board = await prisma.qABoard.update({
      where: { id: params.boardId },
      data: { issueCounter: { increment: 1 } },
      select: { boardKey: true, issueCounter: true },
    });
    const issueKey = `${board.boardKey}-${board.issueCounter}`;

    const issue = await prisma.issue.create({
      data: {
        ...data,
        issueKey,
        tags: data.tags ? JSON.stringify(data.tags) : undefined,
        dueDate: data.dueDate ? new Date(data.dueDate) : undefined,
        boardId: params.boardId,
        source: "web",
        status: "todo",
      },
      include: { _count: { select: { comments: true } } },
    });

    // SSE 브로드캐스트
    sseEmit(params.boardId, "issue_created", issue);

    // ── Figma 연동 (비동기, 응답 지연 없음) ──────────────────────
    if (data.targetUrl) {
      const figma = parseFigmaUrl(data.targetUrl);
      if (figma) {
        (async () => { try {
          const boardForFigma = await prisma.qABoard.findUnique({
            where: { id: params.boardId }, select: { figmaToken: true },
          });
          const figmaToken = boardForFigma?.figmaToken;
          // 3단계: 스크린샷 자동 첨부 (screenshotUrl 미입력 시)
          if (!data.screenshotUrl && figma.nodeId) {
            const imgUrl = await getFigmaFrameImage(figma.fileKey, figma.nodeId, figmaToken);
            if (imgUrl) {
              await prisma.issue.update({
                where: { id: issue.id },
                data: { screenshotUrl: imgUrl },
              });
            }
          }
          // 1단계: Figma 댓글 자동 등록
          if (figma.nodeId) {
            const priLabel: Record<string, string> = { critical: "⛔ Critical", high: "🔴 High", medium: "🟡 Medium", low: "🔵 Low" };
            const msg = `[QA Board] ${issue.issueKey} · ${priLabel[issue.priority] ?? issue.priority}\n${issue.title}${issue.description ? `\n\n${issue.description}` : ""}`;
            const commentId = await createFigmaComment(figma.fileKey, figma.nodeId, msg, figmaToken);
            if (commentId) {
              const ext = issue.externalIds ? JSON.parse(issue.externalIds) : {};
              await prisma.issue.update({
                where: { id: issue.id },
                data: { externalIds: JSON.stringify({ ...ext, figma_comment_id: commentId, figma_file_key: figma.fileKey }) },
              });
            }
          }
        } catch (e) { console.warn("[figma] targetUrl integration error:", e); } })();
      }
    }

    // 비동기 외부 연동 (응답 지연 없이)
    const priLabel: Record<string, string> = { critical: "⛔ Critical", high: "🔴 High", medium: "🟡 Medium", low: "🔵 Low" };
    notifySlack(params.boardId, `새 이슈 *${issue.issueKey}* 생성됨`, [
      { title: "제목", value: issue.title },
      { title: "우선순위", value: priLabel[issue.priority] ?? issue.priority },
      { title: "담당자", value: issue.assignee ?? "미배정" },
    ]);
    createJiraTicket(params.boardId, { title: issue.title, description: issue.description ?? undefined, priority: issue.priority, type: issue.type });

    // GitHub / Figma 보드 단위 연동 (비동기, 응답 지연 없음)
    ;(async () => { try {
      const board = await prisma.qABoard.findUnique({
        where: { id: params.boardId },
        select: { githubOwner: true, githubRepo: true, githubToken: true, figmaFileKey: true, figmaToken: true },
      });
      if (board?.githubOwner && board.githubRepo && board.githubToken) {
        const priLabel: Record<string, string> = { critical: "⛔ Critical", high: "🔴 High", medium: "🟡 Medium", low: "🔵 Low" };
        const body = [
          `**이슈 키:** ${issue.issueKey}`,
          `**우선순위:** ${priLabel[issue.priority] ?? issue.priority}`,
          issue.description ? `\n**설명:**\n${issue.description}` : "",
          issue.stepToReproduce ? `\n**재현 단계:**\n${issue.stepToReproduce}` : "",
          issue.expectedResult  ? `\n**기대 결과:** ${issue.expectedResult}` : "",
          issue.actualResult    ? `\n**실제 결과:** ${issue.actualResult}` : "",
          issue.targetUrl       ? `\n**URL:** ${issue.targetUrl}` : "",
          `\n---\n*QA Board에서 자동 생성된 이슈입니다.*`,
        ].filter(Boolean).join("\n");

        const ghNumber = await createGithubIssue(
          { owner: board.githubOwner, repo: board.githubRepo, token: board.githubToken },
          { title: `[${issue.issueKey}] ${issue.title}`, body, labels: ["qa-board", issue.priority] },
        );
        if (ghNumber) {
          const ext = issue.externalIds ? JSON.parse(issue.externalIds) : {};
          await prisma.issue.update({
            where: { id: issue.id },
            data: { externalIds: JSON.stringify({ ...ext, github_issue_number: ghNumber, github_repo: `${board.githubOwner}/${board.githubRepo}` }) },
          });
        }
      }

      // Figma: 보드에 figmaFileKey 설정된 경우 (이슈 targetUrl 없어도 보드 Figma 파일에 댓글)
      if (board?.figmaFileKey && !data.targetUrl) {
        const priLabel2: Record<string, string> = { critical: "⛔ Critical", high: "🔴 High", medium: "🟡 Medium", low: "🔵 Low" };
        const msg = `[QA Board] ${issue.issueKey} · ${priLabel2[issue.priority] ?? issue.priority}\n${issue.title}`;
        const commentId = await createFigmaComment(board.figmaFileKey, undefined, msg, board.figmaToken);
        if (commentId) {
          const ext = issue.externalIds ? JSON.parse(issue.externalIds) : {};
          await prisma.issue.update({
            where: { id: issue.id },
            data: { externalIds: JSON.stringify({ ...ext, figma_comment_id: commentId, figma_file_key: board.figmaFileKey }) },
          });
        }
      }
    } catch (e) { console.warn("[background] board integration error:", e); } })();

    return NextResponse.json({ issue }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 });
  }
}
