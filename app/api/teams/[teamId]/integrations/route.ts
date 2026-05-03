import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/db/client";
import { getSession } from "@/lib/auth";

type P = { params: { teamId: string } };

const Schema = z.object({
  type: z.enum(["slack", "jira", "email", "notion"]),
  config: z.record(z.string()),
  isActive: z.boolean().optional(),
});

export async function GET(_req: NextRequest, { params }: P) {
  const integrations = await prisma.integration.findMany({
    where: { teamId: params.teamId },
    orderBy: { type: "asc" },
  });
  // config에서 민감 정보 마스킹
  return NextResponse.json({
    integrations: integrations.map(i => ({
      ...i,
      config: maskConfig(JSON.parse(i.config), i.type),
    })),
  });
}

export async function PUT(req: NextRequest, { params }: P) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = Schema.parse(await req.json());

  const integration = await prisma.integration.upsert({
    where: { teamId_type: { teamId: params.teamId, type: body.type } },
    update: { config: JSON.stringify(body.config), isActive: body.isActive ?? true, updatedAt: new Date() },
    create: { teamId: params.teamId, type: body.type, config: JSON.stringify(body.config), isActive: body.isActive ?? true },
  });
  return NextResponse.json({ integration });
}

export async function DELETE(req: NextRequest, { params }: P) {
  const { type } = await req.json();
  await prisma.integration.deleteMany({ where: { teamId: params.teamId, type } });
  return NextResponse.json({ ok: true });
}

function maskConfig(config: Record<string, string>, type: string): Record<string, string> {
  const masked = { ...config };
  const sensitiveKeys = type === "jira" ? ["token"] : ["webhookUrl", "apiKey"];
  sensitiveKeys.forEach(k => { if (masked[k]) masked[k] = masked[k].slice(0, 8) + "…"; });
  return masked;
}
