import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db/client";

export async function POST(_req: NextRequest, { params }: { params: { teamId: string } }) {
  try {
    const integration = await prisma.integration.findUnique({
      where: { teamId_type: { teamId: params.teamId, type: "slack" } },
    });
    if (!integration?.isActive) return NextResponse.json({ ok: false, error: "연동이 비활성 상태입니다." });

    const { webhookUrl } = JSON.parse(integration.config) as { webhookUrl?: string };
    if (!webhookUrl) return NextResponse.json({ ok: false, error: "Webhook URL이 없습니다." });

    const r = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "✅ QA Board Slack 연동 테스트 성공!" }),
    });
    return NextResponse.json({ ok: r.ok, status: r.status });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) });
  }
}
