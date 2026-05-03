import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/db/client";
import { hash } from "@/lib/password";
import { signToken, setSessionCookie } from "@/lib/auth";

const Schema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  name: z.string().min(1).max(50),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { email, password, name } = Schema.parse(body);

    const exists = await prisma.user.findUnique({ where: { email } });
    if (exists) return NextResponse.json({ error: "이미 사용 중인 이메일입니다." }, { status: 409 });

    const hashed = await hash(password);
    const user = await prisma.user.create({ data: { email, name, password: hashed } });

    const token = await signToken({ id: user.id, email: user.email, name: user.name ?? undefined });
    setSessionCookie(token);

    return NextResponse.json({ user: { id: user.id, email: user.email, name: user.name } }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 });
  }
}
