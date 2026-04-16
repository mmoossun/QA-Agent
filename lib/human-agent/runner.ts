/**
 * Human-mode Agent Runner
 * Perception → Action loop using GPT-4o Vision
 * Acts like a real human QA tester: sees screenshot → decides action → executes
 */

import { chromium, type Browser, type Page } from "playwright";
import * as fs from "fs";
import * as path from "path";
import { v4 as uuidv4 } from "uuid";
import { chatWithVision } from "@/lib/ai/openai";
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
  decision: ActionDecision;
  screenshotPath: string;
  success: boolean;
  error?: string;
  durationMs: number;
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
  onStep?: (step: HumanStep) => void;
}

// ─── System Prompt ─────────────────────────────────────────────
const SYSTEM_PROMPT = `You are an expert human QA tester operating a real web browser.
You receive a screenshot of the current browser state and decide the SINGLE NEXT action.

Behave like a real human tester:
- Read the screenshot carefully — identify buttons, inputs, text, errors
- Interact naturally: open menus, type messages, click buttons
- Verify results after each action
- If something is broken, describe it clearly

Respond with ONLY a raw JSON object (no markdown, no code blocks):
{
  "action": "click" | "fill" | "navigate" | "wait" | "scroll" | "press" | "done" | "fail",
  "target": "CSS selector (prefer: button, a, input[type=X], [placeholder=X], .classname)",
  "value": "text to type / URL / key / scroll pixels",
  "description": "what you are doing and why — think out loud",
  "observation": "what you see on screen right now — be specific"
}

Rules:
- click: target = CSS selector or visible button text
- fill: target = input CSS selector, value = text to enter
- navigate: value = full URL
- wait: value = ms as string e.g. "2000"
- scroll: value = pixels as string e.g. "500"
- press: value = Enter | Tab | Escape | Space
- done: goal fully completed — describe what you verified
- fail: bug found or goal impossible — describe the problem

Always return raw JSON only. No extra text.`;

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

    const ctx = await chromium.launch({ headless: true })
      .then((b) => { this.browser = b; return b.newContext({ viewport: { width: 1440, height: 900 }, locale: "ko-KR", timezoneId: "Asia/Seoul" }); });
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

        const { base64, publicPath } = await this._screenshot(`step${step}`);
        const decision = await this._decideAction(base64, step);
        const { success, error } = await this._executeAction(decision);

        const humanStep: HumanStep = {
          stepNumber: step,
          decision,
          screenshotPath: publicPath,
          success,
          error,
          durationMs: Date.now() - stepStart,
        };

        this.steps.push(humanStep);
        this.config.onStep?.(humanStep);

        this.actionHistory.push(
          `Step ${step} [${decision.action}]: ${decision.description}${error ? ` ← FAILED: ${error}` : " ✓"}`
        );

        if (decision.action === "done") { status = "done"; summary = decision.description; break; }
        if (decision.action === "fail") { status = "fail"; summary = decision.description; break; }

        await this.page.waitForTimeout(600);
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
    } catch (e) { logger.warn({ e }, "Human agent login failed"); }
  }

  private async _screenshot(name: string): Promise<{ base64: string; publicPath: string }> {
    const filename = `human_${this.sessionId}_${name}_${Date.now()}.png`;
    const buffer = await this.page!.screenshot({
      path: path.join(SCREENSHOTS_DIR, filename),
      fullPage: false,
      type: "png",
    });
    return { base64: buffer.toString("base64"), publicPath: `/screenshots/${filename}` };
  }

  private async _decideAction(screenshotBase64: string, stepNum: number): Promise<ActionDecision> {
    const historyText = this.actionHistory.length
      ? `\nPrevious steps:\n${this.actionHistory.slice(-8).join("\n")}`
      : "";

    const userMessage =
      `Goal: "${this.config.goal}"\nCurrent URL: ${this.page?.url()}\nStep: ${stepNum}/${this.config.maxSteps ?? 20}${historyText}\n\nWhat is your next action?`;

    try {
      const raw = await chatWithVision(SYSTEM_PROMPT, [{ role: "user", content: userMessage }], screenshotBase64, { maxTokens: 512 });
      return extractJSON<ActionDecision>(raw);
    } catch {
      return { action: "wait", value: "1500", description: "응답 파싱 실패 — 잠시 대기", observation: "파싱 오류" };
    }
  }

  private async _executeAction(d: ActionDecision): Promise<{ success: boolean; error?: string }> {
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
            try {
              await p.locator(sel).first().click({ timeout: 6_000 });
              clicked = true;
            } catch {
              // fallback: text-based click
              const byText = p.getByText(sel, { exact: false });
              if (await byText.count() > 0) { await byText.first().click({ timeout: 6_000 }); clicked = true; }
            }
          }
          if (!clicked) throw new Error(`클릭 대상을 찾을 수 없음: ${sel}`);
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
