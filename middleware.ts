import { NextRequest, NextResponse } from "next/server";

const PUBLIC = ["/login", "/register", "/share", "/api/auth", "/api/share", "/api/screenshots", "/invite"];
const COOKIE = "qa_session";

// Edge Runtime 호환 JWT 검증 (Web Crypto API 사용, jose 불필요)
async function verifyJWT(token: string): Promise<boolean> {
  try {
    const secret = process.env.JWT_SECRET ?? "qa-board-secret-key";
    const parts = token.split(".");
    if (parts.length !== 3) return false;

    const [header, payload, sig] = parts;
    const data = `${header}.${payload}`;

    const keyData = new TextEncoder().encode(secret);
    const key = await crypto.subtle.importKey(
      "raw", keyData, { name: "HMAC", hash: "SHA-256" }, false, ["verify"]
    );

    // base64url → Uint8Array
    const b64 = sig.replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - b64.length % 4) % 4);
    const sigBytes = Uint8Array.from(atob(padded), c => c.charCodeAt(0));

    const valid = await crypto.subtle.verify("HMAC", key, sigBytes, new TextEncoder().encode(data));
    if (!valid) return false;

    // 만료 시간 확인
    const b64pay = payload.replace(/-/g, "+").replace(/_/g, "/");
    const json = JSON.parse(atob(b64pay + "=".repeat((4 - b64pay.length % 4) % 4)));
    if (json.exp && json.exp < Date.now() / 1000) return false;

    return true;
  } catch {
    return false;
  }
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // 공개 경로 통과
  if (PUBLIC.some(p => pathname.startsWith(p))) return NextResponse.next();
  if (pathname.startsWith("/_next") || pathname.startsWith("/favicon")) return NextResponse.next();

  const token = req.cookies.get(COOKIE)?.value;
  const valid = token ? await verifyJWT(token) : false;

  if (!valid) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
    }
    return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(pathname)}`, req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
