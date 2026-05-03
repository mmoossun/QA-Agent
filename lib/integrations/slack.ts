import prisma from "@/lib/db/client";

export async function notifySlack(boardId: string, message: string, fields?: { title: string; value: string }[]) {
  try {
    const board = await prisma.qABoard.findUnique({ where: { id: boardId }, select: { teamId: true, name: true } });
    if (!board?.teamId) return;

    const integration = await prisma.integration.findUnique({
      where: { teamId_type: { teamId: board.teamId, type: "slack" } },
    });
    if (!integration?.isActive) return;

    const { webhookUrl } = JSON.parse(integration.config) as { webhookUrl?: string };
    if (!webhookUrl) return;

    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: `*[QA Board: ${board.name}]* ${message}`,
        attachments: fields?.length ? [{
          color: "#0052CC",
          fields: fields.map(f => ({ title: f.title, value: f.value, short: true })),
        }] : undefined,
      }),
    });
  } catch { /* non-critical */ }
}
