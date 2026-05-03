import { NextResponse } from "next/server";
import { signToken, setSessionCookie } from "@/lib/auth";
import { v4 as uuidv4 } from "uuid";

export async function POST() {
  const guestId = `guest-${uuidv4().slice(0, 8)}`;
  const token = await signToken({ id: guestId, email: "guest", name: "게스트" });
  setSessionCookie(token);
  return NextResponse.json({ ok: true });
}
