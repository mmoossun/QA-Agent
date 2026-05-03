import prisma from "@/lib/db/client";

interface JiraConfig { host: string; email: string; token: string; project: string; }

export async function createJiraTicket(boardId: string, issue: { title: string; description?: string; priority: string; type: string }) {
  try {
    const board = await prisma.qABoard.findUnique({ where: { id: boardId }, select: { teamId: true } });
    if (!board?.teamId) return null;

    const integration = await prisma.integration.findUnique({
      where: { teamId_type: { teamId: board.teamId, type: "jira" } },
    });
    if (!integration?.isActive) return null;

    const cfg = JSON.parse(integration.config) as JiraConfig;
    if (!cfg.host || !cfg.token) return null;

    const priMap: Record<string, string> = { critical: "Highest", high: "High", medium: "Medium", low: "Low" };
    const typeMap: Record<string, string> = { bug: "Bug", task: "Task", story: "Story", improvement: "Task", spec: "Task" };

    const res = await fetch(`${cfg.host}/rest/api/3/issue`, {
      method: "POST",
      headers: {
        "Authorization": `Basic ${Buffer.from(`${cfg.email}:${cfg.token}`).toString("base64")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        fields: {
          project: { key: cfg.project },
          summary: issue.title,
          description: issue.description ? {
            type: "doc", version: 1,
            content: [{ type: "paragraph", content: [{ type: "text", text: issue.description }] }],
          } : undefined,
          issuetype: { name: typeMap[issue.type] ?? "Task" },
          priority: { name: priMap[issue.priority] ?? "Medium" },
        },
      }),
    });

    if (!res.ok) return null;
    const data = await res.json() as { key: string };
    return data.key;
  } catch { return null; }
}
