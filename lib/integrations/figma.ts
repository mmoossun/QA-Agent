const BASE  = "https://api.figma.com/v1";
const TOKEN = () => process.env.FIGMA_ACCESS_TOKEN ?? "";

// ── URL 파싱 ─────────────────────────────────────────────────────
// https://www.figma.com/file/{key}/... or /design/{key}/...?node-id=xxx-yyy
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
): Promise<string | null> {
  const token = TOKEN();
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
export async function deleteFigmaComment(fileKey: string, commentId: string): Promise<boolean> {
  const token = TOKEN();
  if (!token) return false;
  try {
    const res = await fetch(`${BASE}/files/${fileKey}/comments/${commentId}`, {
      method: "DELETE",
      headers: { "X-Figma-Token": token },
    });
    return res.ok;
  } catch { return false; }
}

// ── 3단계: Figma 프레임 스크린샷 URL 가져오기 ───────────────────
export async function getFigmaFrameImage(fileKey: string, nodeId: string): Promise<string | null> {
  const token = TOKEN();
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
