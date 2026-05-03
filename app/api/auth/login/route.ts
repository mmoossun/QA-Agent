import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/db/client";
import { verify } from "@/lib/password";
import { signToken, setSessionCookie } from "@/lib/auth";

const Schema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function POST(req: NextRequest) {
  try {
    const { email, password } = Schema.parse(await req.json());
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user?.password) return NextResponse.json({ error: "이메일 또는 비밀번호가 올바르지 않습니다." }, { status: 401 });

    const ok = await verify(password, user.password);
    if (!ok) return NextResponse.json({ error: "이메일 또는 비밀번호가 올바르지 않습니다." }, { status: 401 });

    const token = await signToken({ id: user.id, email: user.email, name: user.name ?? undefined });
    setSessionCookie(token);

    return NextResponse.json({ user: { id: user.id, email: user.email, name: user.name } });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 });
  }
}
