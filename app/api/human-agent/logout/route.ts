/**
 * POST /api/human-agent/logout
 * Opens a headless browser, logs in, and immediately logs out
 * to clear any lingering server-side sessions from previous tests.
 */
import { NextRequest, NextResponse } from "next/server";
import { chromium } from "playwright";
import { z } from "zod";

const Schema = z.object({
  targetUrl: z.string().url(),
  loginEmail: z.string().email(),
  loginPassword: z.string().min(1),
});

export async function POST(req: NextRequest) {
  const body = await req.json();
  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { targetUrl, loginEmail, loginPassword } = parsed.data;
  const browser = await chromium.launch({ headless: true });

  try {
    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      locale: "ko-KR",
      timezoneId: "Asia/Seoul",
    });
    const page = await ctx.newPage();

    // Navigate to site
    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(1500);

    // ── Login ────────────────────────────────────────────────
    let loggedIn = false;

    // Fill email
    for (const sel of ['input[type="email"]', 'input[placeholder*="메일" i]', 'input[placeholder*="email" i]', 'input[name*="email" i]', 'input[name*="id" i]']) {
      if (await page.locator(sel).count() > 0) {
        await page.fill(sel, loginEmail);
        break;
      }
    }

    // Fill password
    for (const sel of ['input[type="password"]', 'input[placeholder*="비밀번호" i]', 'input[placeholder*="password" i]']) {
      if (await page.locator(sel).count() > 0) {
        await page.fill(sel, loginPassword);
        loggedIn = true;
        break;
      }
    }

    if (loggedIn) {
      // Submit
      for (const sel of ['button[type="submit"]', 'button:has-text("로그인")', 'button:has-text("Login")', 'button:has-text("Sign in")']) {
        if (await page.locator(sel).count() > 0) {
          await page.click(sel);
          break;
        }
      }
      await page.waitForTimeout(3000);
    }

    // ── Logout ───────────────────────────────────────────────
    const origin = new URL(targetUrl).origin;
    let loggedOut = false;

    // 1) Try logout URL paths
    for (const path of ["/logout", "/signout", "/sign-out", "/auth/logout", "/api/auth/signout", "/accounts/logout"]) {
      try {
        const res = await page.goto(`${origin}${path}`, { timeout: 8_000, waitUntil: "domcontentloaded" });
        if (res && res.ok()) { loggedOut = true; break; }
      } catch { /* try next */ }
    }

    // 2) Look for logout selectors if URL approach failed
    if (!loggedOut) {
      const logoutSelectors = [
        'a[href*="logout"]', 'a[href*="signout"]', 'a[href*="sign-out"]',
        'button:has-text("로그아웃")', 'a:has-text("로그아웃")',
        'button:has-text("Logout")', 'button:has-text("Log out")',
        'a:has-text("Logout")', 'a:has-text("Log out")',
        '[aria-label*="logout" i]', '[aria-label*="로그아웃"]',
      ];
      for (const sel of logoutSelectors) {
        if (await page.locator(sel).count() > 0) {
          await page.locator(sel).first().click({ timeout: 4_000 });
          await page.waitForTimeout(1500);
          loggedOut = true;
          break;
        }
      }
    }

    // 3) Try account/profile menu → logout
    if (!loggedOut) {
      const menuSelectors = [
        '[aria-label*="account" i]', '[aria-label*="profile" i]',
        '[aria-label*="프로필"]', '[aria-label*="계정"]',
        'button:has-text("내 정보")', 'button:has-text("프로필")',
      ];
      for (const sel of menuSelectors) {
        if (await page.locator(sel).count() > 0) {
          await page.locator(sel).first().click({ timeout: 3_000 });
          await page.waitForTimeout(800);
          for (const logSel of ['button:has-text("로그아웃")', 'a:has-text("로그아웃")', 'button:has-text("Logout")', 'a:has-text("Logout")']) {
            if (await page.locator(logSel).count() > 0) {
              await page.locator(logSel).first().click({ timeout: 3_000 });
              await page.waitForTimeout(1000);
              loggedOut = true;
              break;
            }
          }
          if (loggedOut) break;
        }
      }
    }

    await ctx.close();

    return NextResponse.json({
      success: true,
      loggedIn,
      loggedOut,
      message: loggedOut
        ? "세션이 성공적으로 종료되었습니다."
        : loggedIn
          ? "로그인은 됐으나 로그아웃 버튼을 찾지 못했습니다. 사이트에서 직접 로그아웃 해주세요."
          : "로그인 폼을 찾지 못했습니다.",
    });
  } catch (err) {
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  } finally {
    await browser.close();
  }
}
