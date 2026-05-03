const BASE = "https://api.figma.com/v1";

// 보드별 토큰 우선, 없으면 환경변수 사용
const resolveToken = (boardToken?: string | null) =>
  boardToken?.trim() || process.env.FIGMA_ACCESS_TOKEN || "";

// ── URL 파싱 ─────────────────────────────────────────────────────
// https://www.figma.com/file/{key}/... or /design/{key}/...?node-id=xxx-yyy
// Figma 코멘트용 이슈 본문 생성
export function buildFigmaCommentBody(issue: {
  issueKey?: string | null;
  title: string;
  type: string;
  priority: string;
  status: string;
  assignee?: string | null;
  reporter?: string | null;
  epicName?: string | null;
  storyPoints?: number | null;
  description?: string | null;
  stepToReproduce?: string | null;
  expectedResult?: string | null;
  actualResult?: string | null;
  environment?: string | null;
  targetUrl?: string | null;
}): string {
  const PRI: Record<string, string> = {
    critical: "⛔ Critical", high: "🔴 High", medium: "🟡 Medium", low: "🔵 Low",
  };
  const TYPE: Record<string, string> = {
    bug: "🐛 버그", task: "✅ 작업", story: "📖 스토리",
    improvement: "⚡ 개선", spec: "📋 스펙",
  };

  const lines: string[] = [
    `[QA Board] ${issue.issueKey ?? ""}  ${TYPE[issue.type] ?? issue.type}  ${PRI[issue.priority] ?? issue.priority}`,
    `━━━━━━━━━━━━━━━━━━━━━━━━`,
    issue.title,
  ];

  // 메타
  const meta: string[] = [];
  if (issue.assignee)   meta.push(`👤 담당자: ${issue.assignee}`);
  if (issue.reporter)   meta.push(`📝 보고자: ${issue.reporter}`);
  if (issue.epicName)   meta.push(`🗂 에픽: ${issue.epicName}`);
  if (issue.storyPoints != null) meta.push(`🎯 ${issue.storyPoints} SP`);
  if (meta.length) lines.push("", meta.join("  ·  "));

  if (issue.description) {
    lines.push("", "📌 설명", issue.description);
  }
  if (issue.stepToReproduce) {
    lines.push("", "🔁 재현 단계", issue.stepToReproduce);
  }
  if (issue.expectedResult) {
    lines.push("", "✅ 기대 결과", issue.expectedResult);
  }
  if (issue.actualResult) {
    lines.push("", "❌ 실제 결과", issue.actualResult);
  }
  if (issue.environment) {
    lines.push("", `🖥 환경: ${issue.environment}`);
  }
  if (issue.targetUrl) {
    lines.push("", `🔗 ${issue.targetUrl}`);
  }

  return lines.join("\n");
}

// 연결 테스트 — /v1/me 호출
export async function testFigmaConnection(boardToken?: string | null): Promise<{ ok: boolean; name?: string }> {
  const token = resolveToken(boardToken);
  if (!token) return { ok: false };
  try {
    const res = await fetch(`${BASE}/me`, { headers: { "X-Figma-Token": token } });
    if (!res.ok) return { ok: false };
    const d = await res.json() as { handle?: string; email?: string };
    return { ok: true, name: d.handle ?? d.email };
  } catch { return { ok: false }; }
}

export function parseFigmaUrl(url: string): { fileKey: string; nodeId?: string } | null {
  try {
    const u = new URL(url);
    const match = u.pathname.match(/\/(file|design|proto)\/([^/]+)/);
    if (!match) return null;
    const fileKey = match[2];
    const raw = u.searchParams.get("node-id");
    // URL에서는 대시(1234-5678), API에서는 콜론(1234:5678)
    const nodeId = raw ? raw.replace(/-/g, ":") : undefined;
    return { fileKey, nodeId };
  } catch { return null; }
}

// ── 1단계: 이슈 생성 시 Figma 댓글 자동 등록 ────────────────────
export async function createFigmaComment(
  fileKey: string,
  nodeId: string | undefined,
  message: string,
  boardToken?: string | null,
): Promise<string | null> {
  const token = resolveToken(boardToken);
  if (!token) return null;
  try {
    const body: Record<string, unknown> = { message };
    if (nodeId) {
      body.client_meta = { node_id: nodeId, node_offset: { x: 0, y: 0 } };
    }
    const res = await fetch(`${BASE}/files/${fileKey}/comments`, {
      method: "POST",
      headers: { "X-Figma-Token": token, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) { console.warn("[figma] comment create failed:", res.status, await res.text()); return null; }
    const data = await res.json() as { id: string };
    return data.id;
  } catch (e) { console.warn("[figma] createComment error:", e); return null; }
}

// ── 2단계: 이슈 해결 시 Figma 댓글 삭제(resolved) ───────────────
export async function deleteFigmaComment(fileKey: string, commentId: string, boardToken?: string | null): Promise<boolean> {
  const token = resolveToken(boardToken);
  if (!token) return false;
  try {
    const res = await fetch(`${BASE}/files/${fileKey}/comments/${commentId}`, {
      method: "DELETE",
      headers: { "X-Figma-Token": token },
    });
    return res.ok;
  } catch { return false; }
}

// ── 파일 프레임 트리 조회 ─────────────────────────────────────────
export interface FigmaFrameNode {
  id: string;
  name: string;
  type: string;
  children?: FigmaFrameNode[];
}
export interface FigmaPage { id: string; name: string; frames: FigmaFrameNode[]; }

type RawNode = { id: string; name: string; type: string; children?: RawNode[] };
const VISIBLE_TYPES = new Set(["FRAME", "SECTION", "COMPONENT", "COMPONENT_SET", "GROUP"]);

function buildNodeTree(raw: RawNode): FigmaFrameNode {
  const node: FigmaFrameNode = { id: raw.id, name: raw.name, type: raw.type };
  const kids = (raw.children ?? []).filter(c => VISIBLE_TYPES.has(c.type)).map(buildNodeTree);
  if (kids.length > 0) node.children = kids;
  return node;
}

export async function getFigmaFileFrames(fileKey: string, boardToken?: string | null): Promise<FigmaPage[]> {
  const token = resolveToken(boardToken);
  if (!token) return [];
  try {
    // depth=3: 페이지 → 프레임 → 프레임 내 섹션/그룹까지 조회
    const res = await fetch(`${BASE}/files/${fileKey}?depth=3`, { headers: { "X-Figma-Token": token } });
    if (!res.ok) return [];
    const data = await res.json() as { document: { children: RawNode[] } };
    return data.document.children
      .filter(page => page.type === "CANVAS")
      .map(page => ({
        id: page.id,
        name: page.name,
        frames: (page.children ?? [])
          .filter(n => VISIBLE_TYPES.has(n.type))
          .map(buildNodeTree),
      }));
  } catch { return []; }
}

// ── 3단계: Figma 프레임 스크린샷 URL 가져오기 ───────────────────
export async function getFigmaFrameImage(fileKey: string, nodeId: string, boardToken?: string | null): Promise<string | null> {
  const token = resolveToken(boardToken);
  if (!token) return null;
  try {
    // API의 ids 파라미터: URL 형식(대시) 사용
    const apiId = nodeId.replace(/:/g, "-");
    const res = await fetch(
      `${BASE}/images/${fileKey}?ids=${encodeURIComponent(apiId)}&format=png&scale=2`,
      { headers: { "X-Figma-Token": token } },
    );
    if (!res.ok) return null;
    const data = await res.json() as { images: Record<string, string> };
    return data.images?.[apiId] ?? null;
  } catch { return null; }
}
