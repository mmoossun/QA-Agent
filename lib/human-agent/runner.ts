/**
 * Human-mode Agent Runner — Hybrid Vision Architecture v3
 *
 * Step 1a — Perception    : Qwen3-VL  → screenshot → screen state / errors / layout (Korean OCR)
 * Step 1b — A11y Snapshot : CDP Accessibility.getFullAXTree → compact @ref element list (cached per URL)
 * Step 2  — Planning      : GPT-4o    → Qwen context + @refs + compressed history → next action JSON
 * Step 3  — Execution     : Playwright getByRole / getByLabel → multi-strategy fallback
 * Step 3b — Validation    : GPT-4o-mini vision → did the action actually work? (retry up to 2×)
 *
 * Improvements v3:
 *  ① Validator Agent   — lightweight post-action verification, retry on failure
 *  ② Context overflow  — goal pinned in system prompt, history compressed beyond 4 steps
 *  ③ A11y caching      — skip re-scan when URL hasn't changed
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

// ─── A11y Ref ─────────────────────────────────────────────────
interface A11yRef {
  ref: string;
  role: string;
  name: string;
  value?: string;
  checked?: boolean;
  expanded?: boolean;
}

interface ValidationResult {
  succeeded: boolean;
  observation: string;
  suggestion?: string;
}

const INTERACTIVE_ROLES = new Set([
  "button", "link", "textbox", "searchbox", "combobox",
  "checkbox", "radio", "switch", "slider", "spinbutton",
  "menuitem", "menuitemcheckbox", "menuitemradio",
  "tab", "option", "listbox", "treeitem",
]);

// Actions that may change page structure → invalidate A11y cache
const CACHE_BUSTING_ACTIONS = new Set<HumanAction>(["navigate", "click", "press"]);

// ─── Planning System Prompt ───────────────────────────────────
// Note: goal is injected at runtime so it stays salient every step
function buildPlanningSystem(goal: string, categories: string[], customPrompt: string): string {
  const categoryLine = categories.length ? `\nFocus areas: ${categories.join(", ")}` : "";
  const customLine = customPrompt ? `\nAdditional instructions: ${customPrompt}` : "";

  return `You are an expert QA tester operating a web browser.
YOUR GOAL (never forget this): "${goal}"${categoryLine}${customLine}

Each step you receive:
  1. A11Y_REFS — interactive elements from the live accessibility tree.
     Each has a short @eN reference. Use ONLY these refs as "target" for click/fill.
  2. SCREEN_DESCRIPTION — Korean OCR + visual context from Qwen3-VL.
     Use for understanding page state, errors, messages, and flow.
     NEVER use selectors from SCREEN_DESCRIPTION — only A11Y_REFS refs are valid.

Rules:
- "target" must be an @eN ref from A11Y_REFS (or a full URL for navigate).
- If the element you need is not listed, use scroll or wait first.
- If the previous action FAILED or was UNVERIFIED, try a completely different approach.
- Detect and report real bugs: wrong errors, missing features, broken flows.

Respond with ONLY raw JSON (no markdown, no code fences):
{
  "action": "click" | "fill" | "navigate" | "wait" | "scroll" | "press" | "done" | "fail",
  "target": "@eN ref  |  full URL for navigate",
  "value": "text to type  |  ms  |  pixels  |  key name",
  "description": "what you are doing and why",
  "observation": "brief summary of current screen state"
}`;
}

// ─── Runner ────────────────────────────────────────────────────
export class HumanAgentRunner {
  private config: HumanAgentConfig;
  private browser: Browser | null = null;
  private page: Page | null = null;
  private sessionId: string;
  private steps: HumanStep[] = [];
  private actionHistory: string[] = [];      // full log
  private accomplishments: string[] = [];    // compressed older steps

  private lastFailureContext: string | null = null;
  private recentActionKeys: string[] = [];   // for stall detection

  private refMap: Map<string, A11yRef> = new Map();
  private a11yCache: { url: string; refs: A11yRef[] } | null = null;  // ③ cache

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

        // ── Stall guard ────────────────────────────────────────
        if (this._isStalled()) {
          logger.warn("Stall detected — forcing scroll");
          await this.page.evaluate(() => window.scrollBy(0, 400));
          await this.page.waitForTimeout(600);
          this.recentActionKeys = [];
        }

        // ── Step 1: Screenshot + Qwen + A11y (parallel) ───────
        const { base64, publicPath } = await this._screenshot(`step${step}`);
        const percStart = Date.now();
        const [perception, a11yRefs] = await Promise.all([
          perceiveScreen(base64, this.page.url()),
          this._snapshotA11y(false),   // false = use cache if available
        ]);
        const perceptionMs = Date.now() - percStart;

        // ── Step 2: GPT-4o Planning ────────────────────────────
        const planStart = Date.now();
        const decision = await this._plan(perception, a11yRefs, step, maxSteps);
        const planningMs = Date.now() - planStart;

        this.recentActionKeys.push(`${decision.action}:${decision.target ?? ""}`);
        if (this.recentActionKeys.length > 3) this.recentActionKeys.shift();

        // ── Step 3: Execution + Validation ────────────────────
        const preUrl = this.page.url();
        let { success, error } = await this._execute(decision);
        this.lastFailureContext = null;

        // Invalidate A11y cache after actions that may change the DOM
        if (CACHE_BUSTING_ACTIONS.has(decision.action)) {
          this.a11yCache = null;
        }

        // ① Validator Agent: verify result for key actions
        if (success && ["click", "fill", "navigate"].includes(decision.action)) {
          const validation = await this._validate(decision, preUrl);
          if (!validation.succeeded) {
            this.lastFailureContext =
              `Action appeared to execute but validation failed: ${validation.observation}.` +
              (validation.suggestion ? ` Try: ${validation.suggestion}` : "");
            success = false;
            error = validation.observation;
          }
        } else if (!success) {
          this.lastFailureContext = `Execution error: ${error}`;
        }

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

        const historyLine =
          `Step ${step} [${decision.action}${decision.target ? " " + decision.target : ""}]: ${decision.description}` +
          (error ? ` ← FAILED: ${error}` : " ✓");
        this.actionHistory.push(historyLine);

        // ② Compress history: keep last 4 full, summarise older
        if (this.actionHistory.length > 4) {
          const oldest = this.actionHistory.shift()!;
          const succeeded = !oldest.includes("FAILED");
          this.accomplishments.push(
            succeeded
              ? oldest.replace(/Step \d+ /, "").split(":").slice(1).join(":").trim()
              : `[FAILED] ${oldest.split(":").slice(1).join(":").trim()}`
          );
        }

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

  // ── ① Validator Agent ─────────────────────────────────────
  private async _validate(action: ActionDecision, preUrl: string): Promise<ValidationResult> {
    try {
      const postUrl = this.page!.url();
      const buffer = await this.page!.screenshot({ fullPage: false, type: "png" });
      const base64 = buffer.toString("base64");

      const response = await openAIClient().chat.completions.create({
        model: "gpt-4o-mini",
        max_tokens: 200,
        messages: [
          {
            role: "system",
            content: `You are a QA validator checking if a browser action succeeded.
Respond with ONLY raw JSON (no markdown):
{"succeeded": true/false, "observation": "what you see now", "suggestion": "alternative if failed"}`,
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text:
                  `Action: [${action.action}] ${action.description}\n` +
                  `URL before: ${preUrl}\nURL after: ${postUrl}\n` +
                  `Did this action succeed? Is the page in the expected state?`,
              },
              { type: "image_url", image_url: { url: `data:image/png;base64,${base64}` } },
            ],
          },
        ],
      });

      const raw = response.choices[0]?.message?.content ?? "";
      return extractJSON<ValidationResult>(raw);
    } catch {
      return { succeeded: true, observation: "validation skipped" };
    }
  }

  // ── ③ A11y snapshot with URL-based cache ─────────────────
  private async _snapshotA11y(forceRefresh: boolean): Promise<A11yRef[]> {
    const currentUrl = this.page?.url() ?? "";

    if (!forceRefresh && this.a11yCache?.url === currentUrl) {
      return this.a11yCache.refs; // cache hit — no CDP round-trip
    }

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

    const capped = refs.slice(0, 60);
    this.a11yCache = { url: currentUrl, refs: capped };
    return capped;
  }

  // ── ② Compressed history builder ─────────────────────────
  private _buildHistoryText(): string {
    const lines: string[] = [];

    if (this.accomplishments.length) {
      lines.push(
        `[이전 ${this.accomplishments.length}스텝 요약] ` +
        this.accomplishments.slice(-5).join(" → ")
      );
    }

    if (this.actionHistory.length) {
      lines.push("Recent steps:");
      lines.push(...this.actionHistory); // at most 4 full entries
    }

    return lines.length ? "\n" + lines.join("\n") : "";
  }

  private _isStalled(): boolean {
    if (this.recentActionKeys.length < 3) return false;
    const [a, b, c] = this.recentActionKeys;
    return a === b && b === c && !a.startsWith("scroll:") && !a.startsWith("wait:");
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
    maxSteps: number,
  ): Promise<ActionDecision> {
    const historyText = this._buildHistoryText();

    const failureText = this.lastFailureContext
      ? `\n\n⚠️ PREVIOUS ACTION FAILED: "${this.lastFailureContext}"\nTry a completely different approach.`
      : "";

    const sheetText = this.config.sheetRawTable
      ? `\n\n--- TEST SHEET ---\n${this.config.sheetRawTable}`
      : "";

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
      `Current URL: ${this.page?.url()}`,
      `Step: ${stepNum}/${maxSteps}${historyText}${sheetText}${failureText}`,
      "",
      "--- A11Y_REFS (use ONLY these @eN refs as target) ---",
      refsText,
      "",
      "--- SCREEN_DESCRIPTION from Qwen3-VL (visual context + Korean OCR) ---",
      perception,
      "",
      "Decide the next action.",
    ].join("\n");

    const systemPrompt = buildPlanningSystem(
      this.config.goal,
      this.config.categories ?? [],
      this.config.customPrompt ?? "",
    );

    try {
      const response = await openAIClient().chat.completions.create({
        model: "gpt-4o",
        max_tokens: 512,
        messages: [
          { role: "system", content: systemPrompt },
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
          const clicked = await this._resolveAndClick(p, d.target ?? "", d.value ?? d.description);
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

  private async _resolveAndClick(p: Page, target: string, hint: string): Promise<boolean> {
    if (target.startsWith("@e")) {
      const ref = this.refMap.get(target);
      if (ref) {
        try {
          const loc = p.getByRole(ref.role as Parameters<typeof p.getByRole>[0], { name: ref.name, exact: false });
          if (await loc.count() > 0) { await loc.first().click({ timeout: 6_000 }); return true; }
        } catch { /* fall through */ }
      }
    }

    const hintText = this.refMap.get(target)?.name ?? hint;

    for (const attempt of [
      () => p.getByRole("button", { name: hintText, exact: false }),
      () => p.getByRole("link", { name: hintText, exact: false }),
      () => p.getByText(hintText, { exact: false }),
      () => p.getByLabel(hintText, { exact: false }),
    ]) {
      try {
        const loc = attempt();
        if (await loc.count() > 0) { await loc.first().click({ timeout: 5_000 }); return true; }
      } catch { /* try next */ }
    }

    return false;
  }

  private async _resolveAndFill(p: Page, target: string, value: string): Promise<boolean> {
    if (target.startsWith("@e")) {
      const ref = this.refMap.get(target);
      if (ref) {
        for (const role of ["textbox", "searchbox", "combobox", "spinbutton"] as const) {
          if (ref.role !== role) continue;
          try {
            const loc = p.getByRole(role, { name: ref.name, exact: false });
            if (await loc.count() > 0) { await loc.first().fill(value, { timeout: 6_000 }); return true; }
          } catch { /* try next */ }
        }
        if (ref.name) {
          try {
            const loc = p.getByLabel(ref.name, { exact: false });
            if (await loc.count() > 0) { await loc.first().fill(value, { timeout: 6_000 }); return true; }
          } catch { /* fall through */ }
        }
      }
    }

    const hint = this.refMap.get(target)?.name ?? target;

    for (const attempt of [
      () => hint && !hint.startsWith("@") ? p.getByLabel(hint, { exact: false }) : null,
      () => hint && !hint.startsWith("@") ? p.getByPlaceholder(hint, { exact: false }) : null,
      () => p.locator("textarea:visible, input:not([type=hidden]):not([type=submit]):visible").first(),
    ]) {
      try {
        const loc = attempt();
        if (loc && await loc.count() > 0) { await loc.fill(value, { timeout: 6_000 }); return true; }
      } catch { /* try next */ }
    }

    return false;
  }
}
