/**
 * Human-mode Agent Runner — Hybrid Vision Architecture
 *
 * Step 1 — Perception  : Qwen3-VL  → screenshot → structured UI description (Korean OCR)
 * Step 2 — Planning    : GPT-4o    → description + goal + history → next action JSON
 * Step 3 — Execution   : Playwright → run action on real browser
 */

import { chromium, type Browser, type Page } from "playwright";
import * as fs from "fs";
import * as path from "path";
import { v4 as uuidv4 } from "uuid";
import { perceiveScreen } from "@/lib/ai/qwen";
import { openAIClient } from "@/lib/ai/openai";
import { extractJSON } from "@/lib/ai/claude";
import { logger } from "@/lib/logger";

const SCREENSHOTS_DIR = path.join(process.cwd(), "public", "screenshots");
fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

// ─── Types ────────────────────────────────────────────────────
export type HumanAction =
  | "click" | "fill" | "navigate" | "wait"
  | "scroll" | "press" | "done" | "fail";

export interface ActionDecision {
  action: HumanAction;
  target?: string;
  value?: string;
  description: string;
  observation: string;
}

export interface HumanStep {
  stepNumber: number;
  perception: string;   // Qwen3-VL output
  decision: ActionDecision;  // GPT-4o output
  screenshotPath: string;
  success: boolean;
  error?: string;
  durationMs: number;
  perceptionMs: number;
  planningMs: number;
}

export interface HumanAgentResult {
  sessionId: string;
  goal: string;
  targetUrl: string;
  steps: HumanStep[];
  status: "done" | "fail" | "max_steps";
  summary: string;
  totalDurationMs: number;
}

export interface HumanAgentConfig {
  targetUrl: string;
  goal: string;
  loginEmail?: string;
  loginPassword?: string;
  maxSteps?: number;
  categories?: string[];
  customPrompt?: string;
  sheetRawTable?: string;
  onStep?: (step: HumanStep) => void;
}

// ─── GPT-4o Planning System Prompt ───────────────────────────
const PLANNING_SYSTEM = `You are an expert QA tester operating a web browser.
You receive a structured description of the current screen (from a vision model) and must decide the SINGLE NEXT action.

Respond with ONLY a raw JSON object (no markdown, no extra text):
{
  "action": "click" | "fill" | "navigate" | "wait" | "scroll" | "press" | "done" | "fail",
  "target": "CSS selector from the screen description",
  "value": "text to type / URL / key / scroll pixels",
  "description": "what you are doing and why — think out loud",
  "observation": "brief summary of current screen state"
}

Action guide:
- click: use the exact selector from INTERACTIVE_ELEMENTS in the description
- fill: target = input selector, value = text to enter
- navigate: value = full URL
- wait: value = ms e.g. "2000"
- scroll: value = pixels e.g. "500"
- press: value = Enter | Tab | Escape
- done: goal fully verified — describe what you confirmed works
- fail: bug found or goal is impossible — describe the issue

Use selectors EXACTLY as listed in INTERACTIVE_ELEMENTS. Return raw JSON only.`;

// ─── Runner ────────────────────────────────────────────────────
export class HumanAgentRunner {
  private config: HumanAgentConfig;
  private browser: Browser | null = null;
  private page: Page | null = null;
  private sessionId: string;
  private steps: HumanStep[] = [];
  private actionHistory: string[] = [];

  constructor(config: HumanAgentConfig) {
    this.config = config;
    this.sessionId = uuidv4().slice(0, 8);
  }

  async run(): Promise<HumanAgentResult> {
    const maxSteps = this.config.maxSteps ?? 20;
    const startTime = Date.now();

    const browser = await chromium.launch({ headless: true });
    this.browser = browser;
    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      locale: "ko-KR",
      timezoneId: "Asia/Seoul",
    });
    this.page = await ctx.newPage();

    try {
      await this.page.goto(this.config.targetUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await this.page.waitForTimeout(2500);

      if (this.config.loginEmail && this.config.loginPassword) {
        await this._tryLogin();
      }

      let status: HumanAgentResult["status"] = "max_steps";
      let summary = "";

      for (let step = 1; step <= maxSteps; step++) {
        const stepStart = Date.now();

        // ── Step 1: Qwen3-VL Perception ───────────────────────
        const { base64, publicPath } = await this._screenshot(`step${step}`);
        const percStart = Date.now();
        const perception = await perceiveScreen(base64, this.page.url());
        const perceptionMs = Date.now() - percStart;

        // ── Step 2: GPT-4o Planning ────────────────────────────
        const planStart = Date.now();
        const decision = await this._plan(perception, step, maxSteps);
        const planningMs = Date.now() - planStart;

        // ── Step 3: Playwright Execution ───────────────────────
        const { success, error } = await this._execute(decision);

        const humanStep: HumanStep = {
          stepNumber: step,
          perception,
          decision,
          screenshotPath: publicPath,
          success,
          error,
          durationMs: Date.now() - stepStart,
          perceptionMs,
          planningMs,
        };

        this.steps.push(humanStep);
        this.config.onStep?.(humanStep);

        this.actionHistory.push(
          `Step ${step} [${decision.action}]: ${decision.description}${error ? ` ← FAILED: ${error}` : " ✓"}`
        );

        if (decision.action === "done") { status = "done"; summary = decision.description; break; }
        if (decision.action === "fail") { status = "fail"; summary = decision.description; break; }

        await this.page.waitForTimeout(700);
      }

      if (status === "max_steps") {
        summary = `최대 ${maxSteps} 스텝 도달. 마지막 관찰: ${this.steps.at(-1)?.decision.observation ?? ""}`;
      }

      return {
        sessionId: this.sessionId,
        goal: this.config.goal,
        targetUrl: this.config.targetUrl,
        steps: this.steps,
        status,
        summary,
        totalDurationMs: Date.now() - startTime,
      };
    } finally {
      await this.browser?.close();
    }
  }

  private async _tryLogin(): Promise<void> {
    const { loginEmail, loginPassword } = this.config;
    if (!loginEmail || !loginPassword || !this.page) return;
    try {
      for (const sel of ['input[type="email"]', 'input[placeholder*="이메일"]', 'input[placeholder*="email" i]']) {
        if (await this.page.locator(sel).count() > 0) { await this.page.fill(sel, loginEmail); break; }
      }
      if (await this.page.locator('input[type="password"]').count() > 0) {
        await this.page.fill('input[type="password"]', loginPassword);
        for (const sel of ['button[type="submit"]', 'button:has-text("로그인")', 'button:has-text("Login")']) {
          if (await this.page.locator(sel).count() > 0) { await this.page.click(sel); break; }
        }
        await this.page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
        await this.page.waitForTimeout(2000);
      }
    } catch (e) { logger.warn({ e }, "Login failed"); }
  }

  private async _screenshot(name: string): Promise<{ base64: string; publicPath: string }> {
    const filename = `human_${this.sessionId}_${name}_${Date.now()}.png`;
    const buffer = await this.page!.screenshot({
      path: path.join(SCREENSHOTS_DIR, filename),
      fullPage: false,
      type: "png",
    });
    return { base64: buffer.toString("base64"), publicPath: `/api/screenshots/${filename}` };
  }

  private async _plan(perception: string, stepNum: number, maxSteps: number): Promise<ActionDecision> {
    const historyText = this.actionHistory.length
      ? `\nPrevious steps:\n${this.actionHistory.slice(-6).join("\n")}`
      : "";

    const categoryText = this.config.categories?.length
      ? `\nFocus areas: ${this.config.categories.join(", ")}`
      : "";

    const sheetText = this.config.sheetRawTable
      ? `\n\n--- TEST SHEET (interpret freely) ---\n${this.config.sheetRawTable}`
      : "";

    const customText = this.config.customPrompt
      ? `\n\nAdditional instructions: ${this.config.customPrompt}`
      : "";

    const userMessage =
      `Goal: "${this.config.goal}"${categoryText}\nCurrent URL: ${this.page?.url()}\nStep: ${stepNum}/${maxSteps}${historyText}${sheetText}${customText}\n\n--- SCREEN DESCRIPTION (from Qwen3-VL) ---\n${perception}\n\nDecide the next action.`;

    try {
      const response = await openAIClient().chat.completions.create({
        model: "gpt-4o",
        max_tokens: 512,
        messages: [
          { role: "system", content: PLANNING_SYSTEM },
          { role: "user", content: userMessage },
        ],
      });
      const raw = response.choices[0]?.message?.content ?? "";
      return extractJSON<ActionDecision>(raw);
    } catch {
      return { action: "wait", value: "1500", description: "플래닝 실패 — 대기", observation: "오류" };
    }
  }

  private async _execute(d: ActionDecision): Promise<{ success: boolean; error?: string }> {
    const p = this.page!;
    try {
      switch (d.action) {
        case "navigate":
          await p.goto(d.value!, { waitUntil: "domcontentloaded", timeout: 20_000 });
          await p.waitForTimeout(1500);
          break;

        case "click": {
          const sel = d.target ?? "";
          let clicked = false;
          if (sel) {
            try { await p.locator(sel).first().click({ timeout: 6_000 }); clicked = true; }
            catch {
              const byText = p.getByText(sel, { exact: false });
              if (await byText.count() > 0) { await byText.first().click({ timeout: 6_000 }); clicked = true; }
            }
          }
          if (!clicked) throw new Error(`클릭 대상 없음: ${sel}`);
          await p.waitForLoadState("networkidle", { timeout: 2_000 }).catch(() => {});
          break;
        }

        case "fill":
          await p.locator(d.target ?? "input").first().fill(d.value ?? "", { timeout: 8_000 });
          break;

        case "wait":
          await p.waitForTimeout(Number(d.value ?? 1000));
          break;

        case "scroll":
          await p.evaluate((y) => window.scrollTo({ top: y, behavior: "smooth" }), Number(d.value ?? 500));
          await p.waitForTimeout(400);
          break;

        case "press":
          await p.keyboard.press(d.value ?? "Enter");
          await p.waitForTimeout(500);
          break;

        case "done":
        case "fail":
          break;
      }
      return { success: true };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
  }
}
