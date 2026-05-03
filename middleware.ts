import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";

// 로그인 없이 접근 가능한 경로
const PUBLIC = [
  "/login", "/register",
  "/share",           // 공개 공유 페이지
  "/api/auth",        // 인증 API
  "/api/share",       // 공개 조회 API
  "/api/screenshots", // 스크린샷
];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // 공개 경로는 통과
  if (PUBLIC.some(p => pathname.startsWith(p))) return NextResponse.next();

  // 정적 파일, Next.js 내부 경로 통과
  if (pathname.startsWith("/_next") || pathname.startsWith("/favicon")) return NextResponse.next();

  // 세션 확인
  const session = await getSessionFromRequest(req);
  if (!session) {
    // API 요청은 401 반환
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
    }
    // 페이지 요청은 로그인으로 리다이렉트
    return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(pathname)}`, req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
