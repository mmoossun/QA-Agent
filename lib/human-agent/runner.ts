/**
 * Human-mode Agent Runner — Hybrid Vision Architecture
 *
 * Step 1a — Perception  : Qwen3-VL  → screenshot → screen state / layout / errors (Korean OCR)
 * Step 1b — DOM Extract : Playwright → real interactive elements with guaranteed selectors
 * Step 2  — Planning    : GPT-4o    → Vision context + DOM elements + history → next action JSON
 * Step 3  — Execution   : Playwright → multi-strategy fallback click/fill
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
  perception: string;
  decision: ActionDecision;
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

interface DOMElement {
  type: string;
  label: string;
  selector: string;
  currentValue?: string;
}

// ─── GPT-4o Planning System Prompt ───────────────────────────
const PLANNING_SYSTEM = `You are an expert QA tester operating a web browser.

Each step you receive two inputs:
  1. REAL_DOM_ELEMENTS — interactive elements queried directly from the live DOM.
     These selectors are GUARANTEED to exist right now. Always use these for click/fill targets.
  2. SCREEN_DESCRIPTION — visual analysis from Qwen3-VL (Korean OCR).
     Use this to understand page state, errors, messages, and overall flow.
     NEVER use selectors from SCREEN_DESCRIPTION — they may be inaccurate.

Decision rules:
- Use selectors from REAL_DOM_ELEMENTS only.
- If the element you need is not listed, use scroll/wait and it will appear next step.
- If goal is achieved and verified, use done.
- If a clear bug or blocker exists, use fail.

Respond with ONLY a raw JSON object (no markdown, no code fences):
{
  "action": "click" | "fill" | "navigate" | "wait" | "scroll" | "press" | "done" | "fail",
  "target": "selector from REAL_DOM_ELEMENTS",
  "value": "text to type / URL / key name / scroll pixels",
  "description": "what you are doing and why",
  "observation": "brief summary of current screen state"
}

Action guide:
- click    : target = selector from REAL_DOM_ELEMENTS
- fill     : target = input selector from REAL_DOM_ELEMENTS, value = text to enter
- navigate : value = full URL
- wait     : value = milliseconds e.g. "2000"
- scroll   : value = pixels to scroll down e.g. "500"
- press    : value = Enter | Tab | Escape
- done     : goal fully verified
- fail     : bug found or goal is impossible`;

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

        // ── Step 1: Screenshot + Perception + DOM (parallel) ──
        const { base64, publicPath } = await this._screenshot(`step${step}`);
        const percStart = Date.now();
        const [perception, domElements] = await Promise.all([
          perceiveScreen(base64, this.page.url()),
          this._extractDOMElements(),
        ]);
        const perceptionMs = Date.now() - percStart;

        // ── Step 2: GPT-4o Planning ────────────────────────────
        const planStart = Date.now();
        const decision = await this._plan(perception, domElements, step, maxSteps);
        const planningMs = Date.now() - planStart;

        // ── Step 3: Playwright Execution ───────────────────────
        const { success, error } = await this._execute(decision, domElements);

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

  // ── Extract real interactive elements from the live DOM ──────
  private async _extractDOMElements(): Promise<DOMElement[]> {
    try {
      return await this.page!.evaluate((): DOMElement[] => {
        const results: DOMElement[] = [];
        const seen = new Set<string>();

        function bestSelector(el: Element): string {
          if (el.id) return `#${CSS.escape(el.id)}`;
          const tag = el.tagName.toLowerCase();
          const ariaLabel = el.getAttribute("aria-label");
          if (ariaLabel) return `[aria-label="${ariaLabel}"]`;
          const placeholder = el.getAttribute("placeholder");
          if (placeholder) return `${tag}[placeholder="${placeholder}"]`;
          const name = el.getAttribute("name");
          if (name) return `${tag}[name="${name}"]`;
          const type = (el as HTMLInputElement).type;
          if (type && type !== "text") return `${tag}[type="${type}"]`;
          // nth-of-type as last resort
          const parent = el.parentElement;
          if (parent) {
            const siblings = Array.from(parent.children).filter(c => c.tagName === el.tagName);
            const idx = siblings.indexOf(el as HTMLElement);
            if (idx >= 0) return `${tag}:nth-of-type(${idx + 1})`;
          }
          return tag;
        }

        function getLabel(el: Element): string {
          return (
            el.getAttribute("aria-label") ||
            el.getAttribute("placeholder") ||
            el.getAttribute("title") ||
            el.textContent?.trim().replace(/\s+/g, " ").slice(0, 80) ||
            el.getAttribute("name") ||
            ""
          );
        }

        function push(type: string, el: Element, extra?: { currentValue?: string }) {
          const label = getLabel(el);
          const selector = bestSelector(el);
          if (seen.has(selector)) return;
          seen.add(selector);
          results.push({ type, label, selector, ...extra });
        }

        // Buttons (skip disabled)
        document.querySelectorAll(
          'button:not([disabled]), [role="button"]:not([disabled]), input[type="submit"], input[type="button"]'
        ).forEach(el => push("button", el));

        // Inputs & textareas (skip hidden/disabled)
        document.querySelectorAll(
          'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([disabled]), textarea:not([disabled])'
        ).forEach(el => {
          const inp = el as HTMLInputElement;
          push(`input[${inp.type || "text"}]`, el, { currentValue: inp.value || undefined });
        });

        // Selects
        document.querySelectorAll("select:not([disabled])").forEach(el => push("select", el));

        // Links (cap at 40, skip blank/hash hrefs)
        let linkCount = 0;
        document.querySelectorAll("a[href]").forEach(el => {
          if (linkCount >= 40) return;
          const href = el.getAttribute("href") ?? "";
          if (!href || href === "#") return;
          const label = getLabel(el);
          if (!label) return;
          const selector = el.id ? `#${CSS.escape(el.id)}` : `a[href="${href}"]`;
          if (seen.has(selector)) return;
          seen.add(selector);
          results.push({ type: "link", label, selector });
          linkCount++;
        });

        return results;
      });
    } catch (e) {
      logger.warn({ e }, "DOM extraction failed");
      return [];
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

  private async _plan(
    perception: string,
    domElements: DOMElement[],
    stepNum: number,
    maxSteps: number
  ): Promise<ActionDecision> {
    const historyText = this.actionHistory.length
      ? `\nPrevious steps:\n${this.actionHistory.slice(-6).join("\n")}`
      : "";

    const categoryText = this.config.categories?.length
      ? `\nFocus areas: ${this.config.categories.join(", ")}`
      : "";

    const sheetText = this.config.sheetRawTable
      ? `\n\n--- TEST SHEET ---\n${this.config.sheetRawTable}`
      : "";

    const customText = this.config.customPrompt
      ? `\n\nAdditional instructions: ${this.config.customPrompt}`
      : "";

    const domText = domElements.length
      ? domElements
          .map(e =>
            `- [${e.type}] "${e.label}" → ${e.selector}` +
            (e.currentValue ? ` (current: "${e.currentValue}")` : "")
          )
          .join("\n")
      : "(no interactive elements found — consider scroll or wait)";

    const userMessage = [
      `Goal: "${this.config.goal}"${categoryText}`,
      `Current URL: ${this.page?.url()}`,
      `Step: ${stepNum}/${maxSteps}${historyText}${sheetText}${customText}`,
      "",
      "--- REAL_DOM_ELEMENTS (guaranteed selectors — use ONLY these for target) ---",
      domText,
      "",
      "--- SCREEN_DESCRIPTION from Qwen3-VL (visual context, Korean OCR — DO NOT use its selectors) ---",
      perception,
      "",
      "Decide the next action.",
    ].join("\n");

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

  private async _execute(
    d: ActionDecision,
    domElements: DOMElement[]
  ): Promise<{ success: boolean; error?: string }> {
    const p = this.page!;
    try {
      switch (d.action) {
        case "navigate":
          await p.goto(d.value!, { waitUntil: "domcontentloaded", timeout: 20_000 });
          await p.waitForTimeout(1500);
          break;

        case "click": {
          const clicked = await this._robustClick(p, d.target ?? "", d.value ?? d.description, domElements);
          if (!clicked) throw new Error(`클릭 대상 없음: ${d.target}`);
          await p.waitForLoadState("networkidle", { timeout: 3_000 }).catch(() => {});
          break;
        }

        case "fill": {
          const filled = await this._robustFill(p, d.target ?? "input", d.value ?? "");
          if (!filled) throw new Error(`입력 대상 없음: ${d.target}`);
          break;
        }

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

  /**
   * Click fallback chain:
   * 1. Exact DOM selector (from REAL_DOM_ELEMENTS)
   * 2. aria-label parsed from selector string
   * 3. getByRole("button") with hint text
   * 4. getByText with hint text
   * 5. getByRole("link") with hint text
   */
  private async _robustClick(
    p: Page,
    selector: string,
    hint: string,
    _domElements: DOMElement[]
  ): Promise<boolean> {
    // 1. Exact selector
    if (selector) {
      try {
        const loc = p.locator(selector).first();
        if (await loc.count() > 0) {
          await loc.click({ timeout: 5_000 });
          return true;
        }
      } catch { /* fall through */ }
    }

    // 2. aria-label parsed from selector
    const ariaMatch = selector.match(/\[aria-label="([^"]+)"\]/);
    if (ariaMatch) {
      try {
        const loc = p.getByLabel(ariaMatch[1]);
        if (await loc.count() > 0) {
          await loc.first().click({ timeout: 5_000 });
          return true;
        }
      } catch { /* fall through */ }
    }

    const hintText = hint || selector;

    // 3. getByRole button
    if (hintText) {
      try {
        const loc = p.getByRole("button", { name: hintText, exact: false });
        if (await loc.count() > 0) {
          await loc.first().click({ timeout: 5_000 });
          return true;
        }
      } catch { /* fall through */ }
    }

    // 4. getByText
    if (hintText) {
      try {
        const loc = p.getByText(hintText, { exact: false });
        if (await loc.count() > 0) {
          await loc.first().click({ timeout: 5_000 });
          return true;
        }
      } catch { /* fall through */ }
    }

    // 5. getByRole link
    if (hintText) {
      try {
        const loc = p.getByRole("link", { name: hintText, exact: false });
        if (await loc.count() > 0) {
          await loc.first().click({ timeout: 5_000 });
          return true;
        }
      } catch { /* fall through */ }
    }

    return false;
  }

  /**
   * Fill fallback chain:
   * 1. Exact selector
   * 2. Placeholder parsed from selector string
   * 3. First visible input/textarea on page
   */
  private async _robustFill(p: Page, selector: string, value: string): Promise<boolean> {
    // 1. Exact selector
    try {
      const loc = p.locator(selector).first();
      if (await loc.count() > 0) {
        await loc.fill(value, { timeout: 6_000 });
        return true;
      }
    } catch { /* fall through */ }

    // 2. Placeholder parsed from selector
    const placeholderMatch = selector.match(/\[placeholder="([^"]+)"\]/);
    if (placeholderMatch) {
      try {
        const loc = p.getByPlaceholder(placeholderMatch[1]);
        if (await loc.count() > 0) {
          await loc.first().fill(value, { timeout: 6_000 });
          return true;
        }
      } catch { /* fall through */ }
    }

    // 3. First visible input or textarea
    try {
      const loc = p.locator("textarea:visible, input:visible").first();
      if (await loc.count() > 0) {
        await loc.fill(value, { timeout: 6_000 });
        return true;
      }
    } catch { /* fall through */ }

    return false;
  }
}
