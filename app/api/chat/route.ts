/**
 * POST /api/chat
 * Natural language → QA scenarios → (optional) run → results
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { chat, extractJSON } from "@/lib/ai/claude";
import { buildChatQAPrompt, CHAT_QA_SYSTEM } from "@/lib/ai/prompts";
import type { QAScenario } from "@/lib/ai/types";
import { logger } from "@/lib/logger";
import { saveRun } from "@/lib/db/history";
import { v4 as uuidv4 } from "uuid";

const RequestSchema = z.object({
  message: z.string().min(1).max(2000),
  projectId: z.string().optional(),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() }))
    .default([]),
  executeNow: z.boolean().default(false),
  targetUrl: z.string().url().optional(),
  loginEmail: z.string().optional(),
  loginPassword: z.string().optional(),
});

// ─── Quick page snapshot via Playwright ──────────────────────
async function quickSnapshot(url: string, loginEmail?: string, loginPassword?: string): Promise<string> {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: "ko-KR" });

  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 });
    await page.waitForTimeout(2000);

    // Login if credentials provided and login form exists
    if (loginEmail && loginPassword && await page.locator('input[type="password"]').count() > 0) {
      for (const sel of ['input[type="email"]', 'input[placeholder*="이메일"]', 'input[placeholder*="email" i]']) {
        if (await page.locator(sel).count() > 0) { await page.fill(sel, loginEmail); break; }
      }
      await page.fill('input[type="password"]', loginPassword);
      for (const sel of ['button[type="submit"]', 'button:has-text("로그인")', 'button:has-text("Login")']) {
        if (await page.locator(sel).count() > 0) { await page.click(sel); break; }
      }
      await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
      await page.waitForTimeout(1500);
    }

    const snapshot = await page.evaluate(() => {
      const lines: string[] = [];
      lines.push(`URL: ${window.location.href}`);
      lines.push(`Title: ${document.title}`);

      // Buttons
      const btns = Array.from(document.querySelectorAll('button, [role="button"]')).slice(0, 30);
      if (btns.length) {
        lines.push("\n[Buttons]");
        btns.forEach((el) => {
          const text = el.textContent?.trim().slice(0, 50) || "";
          const aria = el.getAttribute("aria-label") || "";
          const cls = (el.className?.toString() || "").slice(0, 60);
          const tid = el.getAttribute("data-testid") || "";
          if (text || aria) lines.push(`  button: text="${text}" aria="${aria}" class="${cls}" testid="${tid}"`);
        });
      }

      // Inputs
      const inputs = Array.from(document.querySelectorAll('input, textarea, select')).slice(0, 20);
      if (inputs.length) {
        lines.push("\n[Inputs]");
        inputs.forEach((el) => {
          const e = el as HTMLInputElement;
          lines.push(`  ${el.tagName.toLowerCase()}: type="${e.type}" placeholder="${e.placeholder}" id="${e.id}" name="${e.name}"`);
        });
      }

      // Iframes
      const iframes = Array.from(document.querySelectorAll("iframe")).slice(0, 5);
      if (iframes.length) {
        lines.push("\n[Iframes]");
        iframes.forEach((f) => lines.push(`  iframe: src="${f.src}" id="${f.id}"`));
      }

      // Links (top 15)
      const links = Array.from(document.querySelectorAll("a[href]")).slice(0, 15);
      if (links.length) {
        lines.push("\n[Links]");
        links.forEach((el) => {
          const text = el.textContent?.trim().slice(0, 40) || "";
          const href = el.getAttribute("href") || "";
          if (text) lines.push(`  link: text="${text}" href="${href}"`);
        });
      }

      return lines.join("\n");
    });

    logger.info({ url }, "Page snapshot collected for Chat QA");
    return snapshot;
  } catch (err) {
    logger.warn({ url, err: String(err) }, "Snapshot failed, proceeding without");
    return `URL: ${url} (snapshot failed — using generic selectors)`;
  } finally {
    await browser.close();
  }
}

export async function POST(req: NextRequest) {
  const startTime = Date.now();
  try {
    const body = await req.json();
    const parsed = RequestSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
    }

    const { message, history, executeNow, targetUrl, loginEmail, loginPassword } = parsed.data;

    logger.info({ message: message.slice(0, 80), executeNow }, "Chat request");

    // Collect real DOM snapshot before generating scenarios
    let pageContext = "";
    if (targetUrl) {
      pageContext = await quickSnapshot(targetUrl, loginEmail, loginPassword);
    }

    // Build conversation messages
    const promptWithContext = pageContext
      ? `${buildChatQAPrompt(message)}\n\n---\nREAL PAGE SNAPSHOT (use these EXACT selectors):\n${pageContext}\n\nCRITICAL: Use only selectors found in the snapshot above. Do NOT invent selectors.`
      : buildChatQAPrompt(message);

    const messages: { role: "user" | "assistant"; content: string }[] = [
      ...history,
      { role: "user", content: promptWithContext },
    ];

    // Get scenarios from Claude
    const aiResponse = await chat(messages, CHAT_QA_SYSTEM, { maxTokens: 4000, useCache: true });

    let scenarios: QAScenario[] = [];
    let parseError: string | undefined;

    try {
      scenarios = extractJSON<QAScenario[]>(aiResponse);
      if (!Array.isArray(scenarios)) scenarios = [scenarios as unknown as QAScenario];
    } catch (err) {
      parseError = String(err);
      logger.warn({ err: parseError }, "Failed to parse scenarios, returning raw response");
    }

    // Execute if requested and URL provided
    let results = null;
    if (executeNow && targetUrl && scenarios.length > 0) {
      const { QARunner } = await import("@/lib/qa/runner");
      const runner = new QARunner({ baseUrl: targetUrl });
      await runner.init();
      try {
        results = await runner.runAll(scenarios);
      } finally {
        await runner.close();
      }

      // Persist run to history
      const passCount = results.filter((r) => r.status === "pass").length;
      saveRun({
        id: uuidv4().slice(0, 12),
        mode: "chat",
        targetUrl,
        scenarioCount: results.length,
        passCount,
        failCount: results.length - passCount,
        score: null,
        passRate: results.length > 0 ? (passCount / results.length) * 100 : 0,
        duration: Date.now() - startTime,
        status: "completed",
        createdAt: new Date().toISOString(),
      });
    }

    return NextResponse.json({
      success: true,
      scenarios,
      results,
      rawResponse: parseError ? aiResponse : undefined,
      message: parseError
        ? "Could not parse scenarios — showing raw AI response"
        : `Generated ${scenarios.length} test scenario(s)`,
    });
  } catch (err) {
    logger.error({ err }, "Chat API error");
    return NextResponse.json({ error: "Internal server error", detail: String(err) }, { status: 500 });
  }
}
