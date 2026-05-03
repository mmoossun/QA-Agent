const BASE = "https://api.github.com";

interface GHConfig { owner: string; repo: string; token: string; }

function headers(token: string) {
  return {
    "Authorization": `Bearer ${token}`,
    "Accept": "application/vnd.github+json",
    "Content-Type": "application/json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

// 이슈 생성 → GitHub Issue 번호 반환
export async function createGithubIssue(
  cfg: GHConfig,
  issue: { title: string; body?: string; labels?: string[] },
): Promise<number | null> {
  try {
    const res = await fetch(`${BASE}/repos/${cfg.owner}/${cfg.repo}/issues`, {
      method: "POST",
      headers: headers(cfg.token),
      body: JSON.stringify({ title: issue.title, body: issue.body, labels: issue.labels }),
    });
    if (!res.ok) { console.warn("[github] issue create failed:", res.status, await res.text()); return null; }
    const data = await res.json() as { number: number };
    return data.number;
  } catch (e) { console.warn("[github] createIssue error:", e); return null; }
}

// 이슈 닫기 (done 처리 시)
export async function closeGithubIssue(cfg: GHConfig, issueNumber: number): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/repos/${cfg.owner}/${cfg.repo}/issues/${issueNumber}`, {
      method: "PATCH",
      headers: headers(cfg.token),
      body: JSON.stringify({ state: "closed", state_reason: "completed" }),
    });
    return res.ok;
  } catch { return false; }
}

// 레포 연결 테스트
export async function testGithubConnection(cfg: GHConfig): Promise<{ ok: boolean; repoName?: string }> {
  try {
    const res = await fetch(`${BASE}/repos/${cfg.owner}/${cfg.repo}`, { headers: headers(cfg.token) });
    if (!res.ok) return { ok: false };
    const data = await res.json() as { full_name: string };
    return { ok: true, repoName: data.full_name };
  } catch { return { ok: false }; }
}
