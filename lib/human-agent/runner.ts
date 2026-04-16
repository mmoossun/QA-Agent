/**
 * Human-mode Agent Runner — Hybrid Vision Architecture v2
 *
 * Step 1a — Perception    : Qwen3-VL  → screenshot → screen state / errors / layout (Korean OCR)
 * Step 1b — A11y Snapshot : Playwright accessibility.snapshot() → compact @ref element list
 * Step 2  — Planning      : GPT-4o    → Qwen context + @refs → next action JSON
 * Step 3  — Execution     : Playwright getByRole / getByLabel → multi-strategy fallback
 * Step 3b — Reflection    : failed action error is injected into next planning prompt
 *           Stall guard   : same action repeated 3× → force scroll/wait
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
  target?: string;   // @eN ref or URL or key
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

// ─── A11y Ref ─────────────────────────────────────────────────
interface A11yRef {
  ref: string;       // @e1, @e2, ...
  role: string;      // button | link | textbox | checkbox | ...
  name: string;      // accessible name (label / aria-label / text)
  value?: string;    // current input value
  checked?: boolean;
  expanded?: boolean;
}

const INTERACTIVE_ROLES = new Set([
  "button", "link", "textbox", "searchbox", "combobox",
  "checkbox", "radio", "switch", "slider", "spinbutton",
  "menuitem", "menuitemcheckbox", "menuitemradio",
  "tab", "option", "listbox", "treeitem",
]);

// ─── GPT-4o Planning System Prompt ───────────────────────────
const PLANNING_SYSTEM = `You are an expert QA tester operating a web browser.

Each step you receive:
  1. A11Y_REFS — interactive elements from the live accessibility tree.
     Each has a short @eN reference. Use ONLY these refs as "target" for click/fill.
  2. SCREEN_DESCRIPTION — Korean OCR + visual context from Qwen3-VL.
     Use this to understand page state, errors, messages, flow.
     Never use selectors or refs from SCREEN_DESCRIPTION — only A11Y_REFS refs are valid.

Rules:
- "target" must be an @eN ref from A11Y_REFS (or a URL for navigate).
- If the element you need is not in A11Y_REFS, use scroll/wait first.
- If the previous action FAILED, try a completely different approach.
- Detect and report real bugs (wrong error messages, missing features, broken flows).

Respond with ONLY raw JSON (no markdown, no code fences):
{
  "action": "click" | "fill" | "navigate" | "wait" | "scroll" | "press" | "done" | "fail",
  "target": "@eN ref from A11Y_REFS  |  full URL for navigate",
  "value": "text to type  |  ms to wait  |  pixels to scroll  |  key name",
  "description": "what you are doing and why",
  "observation": "brief summary of current screen state"
}

Action guide:
- click    : target = @eN (button or link)
- fill     : target = @eN (textbox/combobox), value = text to enter
- navigate : value = full URL (no target needed)
- wait     : value = milliseconds e.g. "2000"
- scroll   : value = pixels to scroll down e.g. "500"
- press    : value = Enter | Tab | Escape
- done     : goal fully achieved and verified
- fail     : real bug found or goal is impossible — describe clearly`;

// ─── Runner ────────────────────────────────────────────────────
export class HumanAgentRunner {
  private config: HumanAgentConfig;
  private browser: Browser | null = null;
  private page: Page | null = null;
  private sessionId: string;
  private steps: HumanStep[] = [];
  private actionHistory: string[] = [];

  // Reflection & stall detection state
  private lastFailureError: string | null = null;
  private recentActionKeys: string[] = []; // last 3 "action:target" strings

  // Current step's ref map (rebuilt each step)
  private refMap: Map<string, A11yRef> = new Map();

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

        // ── Stall guard: force scroll if stuck ────────────────
        if (this._isStalled()) {
          logger.warn("Stall detected — injecting scroll");
          await this.page.evaluate(() => window.scrollBy(0, 400));
          await this.page.waitForTimeout(600);
          this.recentActionKeys = [];
        }

        // ── Step 1: Screenshot + Qwen perception + A11y (parallel)
        const { base64, publicPath } = await this._screenshot(`step${step}`);
        const percStart = Date.now();
        const [perception, a11yRefs] = await Promise.all([
          perceiveScreen(base64, this.page.url()),
          this._snapshotA11y(),
        ]);
        const perceptionMs = Date.now() - percStart;

        // ── Step 2: GPT-4o Planning ────────────────────────────
        const planStart = Date.now();
        const decision = await this._plan(perception, a11yRefs, step, maxSteps);
        const planningMs = Date.now() - planStart;

        // Track action key for stall detection
        this.recentActionKeys.push(`${decision.action}:${decision.target ?? ""}`);
        if (this.recentActionKeys.length > 3) this.recentActionKeys.shift();

        // ── Step 3: Execution ──────────────────────────────────
        const { success, error } = await this._execute(decision);

        // Reflection: store failure for next planning step
        this.lastFailureError = success ? null : (error ?? "unknown error");

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
          `Step ${step} [${decision.action}${decision.target ? " " + decision.target : ""}]: ${decision.description}` +
          (error ? ` ← FAILED: ${error}` : " ✓")
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

  // ── A11y snapshot via CDP → compact @ref list ────────────
  private async _snapshotA11y(): Promise<A11yRef[]> {
    this.refMap.clear();
    const refs: A11yRef[] = [];
    let counter = 1;

    type CDPAXNode = {
      nodeId: string;
      ignored?: boolean;
      role?: { value: string };
      name?: { value: string };
      value?: { value: string };
      properties?: Array<{ name: string; value: { value: unknown } }>;
      childIds?: string[];
    };

    try {
      const client = await this.page!.context().newCDPSession(this.page!);
      const { nodes } = await client.send("Accessibility.getFullAXTree") as { nodes: CDPAXNode[] };
      await client.detach();

      for (const node of nodes) {
        if (node.ignored) continue;
        const role = node.role?.value?.toLowerCase() ?? "";
        const name = (node.name?.value ?? "").trim();

        if (!INTERACTIVE_ROLES.has(role)) continue;

        // Skip disabled elements
        const disabled = node.properties?.find(p => p.name === "disabled")?.value?.value;
        if (disabled === true) continue;

        const value = node.value?.value ? String(node.value.value) : undefined;
        const checked = node.properties?.find(p => p.name === "checked")?.value?.value;
        const expanded = node.properties?.find(p => p.name === "expanded")?.value?.value;

        const ref: A11yRef = {
          ref: `@e${counter++}`,
          role,
          name,
          value,
          checked: typeof checked === "boolean" ? checked : undefined,
          expanded: typeof expanded === "boolean" ? expanded : undefined,
        };
        refs.push(ref);
        this.refMap.set(ref.ref, ref);
      }
    } catch (e) {
      logger.warn({ e }, "A11y CDP snapshot failed");
    }

    return refs.slice(0, 60); // cap to avoid overwhelming GPT-4o
  }

  // ── Stall detection ────────────────────────────────────────
  private _isStalled(): boolean {
    if (this.recentActionKeys.length < 3) return false;
    const [a, b, c] = this.recentActionKeys;
    return a === b && b === c && a !== "scroll:" && a !== "wait:";
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
    a11yRefs: A11yRef[],
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

    // Reflection: inject failure context
    const reflectionText = this.lastFailureError
      ? `\n\n⚠️ PREVIOUS ACTION FAILED: "${this.lastFailureError}"\nTry a completely different approach — do not repeat the same action.`
      : "";

    // Compact @ref list
    const refsText = a11yRefs.length
      ? a11yRefs.map(r => {
          let line = `${r.ref} [${r.role}] "${r.name}"`;
          if (r.value) line += ` (value: "${r.value}")`;
          if (r.checked !== undefined) line += ` (checked: ${r.checked})`;
          if (r.expanded !== undefined) line += ` (expanded: ${r.expanded})`;
          return line;
        }).join("\n")
      : "(no interactive elements — try scroll or wait)";

    const userMessage = [
      `Goal: "${this.config.goal}"${categoryText}`,
      `Current URL: ${this.page?.url()}`,
      `Step: ${stepNum}/${maxSteps}${historyText}${sheetText}${customText}${reflectionText}`,
      "",
      "--- A11Y_REFS (use ONLY these @eN refs as target) ---",
      refsText,
      "",
      "--- SCREEN_DESCRIPTION from Qwen3-VL (visual context + Korean OCR — DO NOT use its element refs) ---",
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

  private async _execute(d: ActionDecision): Promise<{ success: boolean; error?: string }> {
    const p = this.page!;
    try {
      switch (d.action) {
        case "navigate":
          await p.goto(d.value!, { waitUntil: "domcontentloaded", timeout: 20_000 });
          await p.waitForTimeout(1500);
          break;

        case "click": {
          const clicked = await this._resolveAndClick(p, d.target ?? "");
          if (!clicked) throw new Error(`클릭 실패: ${d.target}`);
          await p.waitForLoadState("networkidle", { timeout: 3_000 }).catch(() => {});
          break;
        }

        case "fill": {
          const filled = await this._resolveAndFill(p, d.target ?? "", d.value ?? "");
          if (!filled) throw new Error(`입력 실패: ${d.target}`);
          break;
        }

        case "wait":
          await p.waitForTimeout(Number(d.value ?? 1000));
          break;

        case "scroll":
          await p.evaluate((y) => window.scrollBy({ top: y, behavior: "smooth" }), Number(d.value ?? 500));
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
   * Click resolution chain (A11y-first):
   * 1. @eN ref → getByRole(role, {name}) from a11y tree
   * 2. getByRole("button", {name: hint})
   * 3. getByRole("link", {name: hint})
   * 4. getByText(hint)
   * 5. getByLabel(hint)
   */
  private async _resolveAndClick(p: Page, target: string): Promise<boolean> {
    // 1. Resolve @eN ref via a11y map
    if (target.startsWith("@e")) {
      const ref = this.refMap.get(target);
      if (ref) {
        try {
          const loc = p.getByRole(ref.role as Parameters<typeof p.getByRole>[0], {
            name: ref.name,
            exact: false,
          });
          if (await loc.count() > 0) {
            await loc.first().click({ timeout: 6_000 });
            return true;
          }
        } catch { /* fall through */ }
      }
    }

    // Derive hint text from target string or ref name
    const hint = (this.refMap.get(target)?.name) ?? target;

    // 2. getByRole button
    if (hint) {
      try {
        const loc = p.getByRole("button", { name: hint, exact: false });
        if (await loc.count() > 0) { await loc.first().click({ timeout: 5_000 }); return true; }
      } catch { /* fall through */ }
    }

    // 3. getByRole link
    if (hint) {
      try {
        const loc = p.getByRole("link", { name: hint, exact: false });
        if (await loc.count() > 0) { await loc.first().click({ timeout: 5_000 }); return true; }
      } catch { /* fall through */ }
    }

    // 4. getByText
    if (hint) {
      try {
        const loc = p.getByText(hint, { exact: false });
        if (await loc.count() > 0) { await loc.first().click({ timeout: 5_000 }); return true; }
      } catch { /* fall through */ }
    }

    // 5. getByLabel
    if (hint) {
      try {
        const loc = p.getByLabel(hint, { exact: false });
        if (await loc.count() > 0) { await loc.first().click({ timeout: 5_000 }); return true; }
      } catch { /* fall through */ }
    }

    return false;
  }

  /**
   * Fill resolution chain (A11y-first):
   * 1. @eN ref → getByRole("textbox" | "searchbox" | "combobox", {name})
   * 2. getByLabel(name)
   * 3. getByPlaceholder(name)
   * 4. first visible input/textarea
   */
  private async _resolveAndFill(p: Page, target: string, value: string): Promise<boolean> {
    // 1. Resolve @eN ref
    if (target.startsWith("@e")) {
      const ref = this.refMap.get(target);
      if (ref) {
        const fillRoles = ["textbox", "searchbox", "combobox", "spinbutton"] as const;
        for (const role of fillRoles) {
          if (ref.role !== role) continue;
          try {
            const loc = p.getByRole(role, { name: ref.name, exact: false });
            if (await loc.count() > 0) {
              await loc.first().fill(value, { timeout: 6_000 });
              return true;
            }
          } catch { /* try next */ }
        }
        // fallback: getByLabel with ref name
        if (ref.name) {
          try {
            const loc = p.getByLabel(ref.name, { exact: false });
            if (await loc.count() > 0) { await loc.first().fill(value, { timeout: 6_000 }); return true; }
          } catch { /* fall through */ }
        }
      }
    }

    const hint = (this.refMap.get(target)?.name) ?? target;

    // 2. getByLabel
    if (hint && !hint.startsWith("@")) {
      try {
        const loc = p.getByLabel(hint, { exact: false });
        if (await loc.count() > 0) { await loc.first().fill(value, { timeout: 6_000 }); return true; }
      } catch { /* fall through */ }
    }

    // 3. getByPlaceholder
    if (hint && !hint.startsWith("@")) {
      try {
        const loc = p.getByPlaceholder(hint, { exact: false });
        if (await loc.count() > 0) { await loc.first().fill(value, { timeout: 6_000 }); return true; }
      } catch { /* fall through */ }
    }

    // 4. First visible input/textarea
    try {
      const loc = p.locator("textarea:visible, input:not([type=hidden]):not([type=submit]):visible").first();
      if (await loc.count() > 0) { await loc.fill(value, { timeout: 6_000 }); return true; }
    } catch { /* fall through */ }

    return false;
  }
}
