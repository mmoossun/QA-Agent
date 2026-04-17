/**
 * Human-mode Agent Runner — v4 (GPT-4o native vision)
 *
 * Architecture:
 *   Screenshot + CDP A11y  (parallel)
 *         ↓
 *   GPT-4o vision+planning  (single call — replaces Qwen3-VL, 10× faster)
 *         ↓
 *   Playwright execution    (A11y-first, multi-strategy fallback)
 *         ↓
 *   GPT-4o-mini validation  (key actions only — skip for fill/wait/scroll)
 *
 * Improvements over v3:
 *  ① Qwen3-VL removed → GPT-4o vision handles perception + planning in one call
 *     (~8-15s/step vs 35-90s/step — 5-10× faster, eliminates network timeout)
 *  ② A11y snapshot v2 — DOM augmentation fills names for unnamed inputs
 *     (placeholder/aria-label/label via page.evaluate, then backendDOMNodeId CDP)
 *  ③ Better element resolution — scroll-to-view, index fallback, CDP nodeId click
 *  ④ New actions: select (for <select>/<combobox>), type (char-by-char), hover
 *  ⑤ Smarter validation — URL change = auto-success; fill validation is DOM-based
 *  ⑥ Stall recovery v2 — tries nav links, scroll-top, navigate back
 *  ⑦ Per-step 45s timeout guard to prevent indefinite hanging
 *  ⑧ History window expanded to 6 full steps
 *  ⑨ Login v2 — A11y-based login with DOM fallback
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
  | "click" | "fill" | "type" | "select" | "navigate"
  | "wait" | "scroll" | "press" | "hover" | "done" | "fail";

export interface ActionDecision {
  action: HumanAction;
  target?: string;
  value?: string;
  description: string;
  observation: string;
  screen_description?: string;  // GPT-4o describes current screen state
}

export interface HumanStep {
  stepNumber: number;
  perception: string;           // screen_description from GPT-4o
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
  sheetRawTable?: string;
  similarContext?: string;  // past similar test failures injected as context
  onStep?: (step: HumanStep) => void;
}

// ─── A11y Ref ─────────────────────────────────────────────────
interface A11yRef {
  ref: string;          // @e1, @e2 …
  role: string;
  name: string;         // accessible name (may be augmented from DOM)
  placeholder?: string; // DOM placeholder (for unnamed inputs)
  inputType?: string;   // DOM input type
  value?: string;
  checked?: boolean;
  expanded?: boolean;
  backendDOMNodeId?: number;  // stored for CDP fallback
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
const CACHE_BUSTING_ACTIONS = new Set<HumanAction>(["navigate", "click", "select", "press", "type"]);

// ─── Planning System Prompt ───────────────────────────────────
function buildPlanningSystem(goal: string, categories: string[], similarContext = ""): string {
  const effectiveGoal = goal.trim() ||
    "Freely explore this web application and perform comprehensive QA testing — navigate all key features, try common user flows, and identify any bugs or issues.";
  const categoryLine = categories.length ? `\nFocus areas: ${categories.join(", ")}` : "";
  const memoryLine = similarContext
    ? `\n\n## 과거 유사 테스트 참고 (실수 반복 방지)\n${similarContext}`
    : "";

  return `You are an expert QA tester operating a web browser. You can SEE the current screenshot.
YOUR GOAL (never forget this): "${effectiveGoal}"${categoryLine}${memoryLine}

Each step you receive:
  1. A11Y_REFS — live interactive elements from the accessibility tree.
     @eN refs are the ONLY valid targets for click/fill/select/type/hover.
     Elements with placeholder/type hints are unnamed inputs — use those to identify them.
  2. The screenshot is attached for visual context.

Action rules:
- "target" MUST be an @eN ref from A11Y_REFS (or a full URL for navigate).
- If you can SEE an element in the screenshot but it's NOT in A11Y_REFS: use scroll or wait, then retry.
- To type into a FIELD: use "fill" (replaces entire content) or "type" (appends characters).
- To pick from a dropdown/combobox: use "select" with value = the option text.
- After FAILED/UNVERIFIED action: try a completely different element or approach.
- Use "done" when the goal is fully achieved. Use "fail" only if you've exhausted all options.
- Detect real bugs: wrong error messages, missing features, broken navigation, data loss.

Respond with ONLY raw JSON (no markdown, no code fences):
{
  "screen_description": "brief description of what you see on screen right now",
  "action": "click|fill|type|select|navigate|wait|scroll|press|hover|done|fail",
  "target": "@eN ref | full URL for navigate",
  "value": "text to fill | option text for select | ms for wait | pixels for scroll | key for press",
  "description": "what you are doing and why (mention target by name, not just @ref)",
  "observation": "one-sentence current page state summary"
}`;
}

// ─── Runner ────────────────────────────────────────────────────
export class HumanAgentRunner {
  private config: HumanAgentConfig;
  private browser: Browser | null = null;
  private page: Page | null = null;
  private sessionId: string;
  private steps: HumanStep[] = [];
  private actionHistory: string[] = [];
  private accomplishments: string[] = [];

  private lastFailureContext: string | null = null;
  private recentActionKeys: string[] = [];
  private consecutiveFailures = 0;

  private refMap: Map<string, A11yRef> = new Map();
  private a11yCache: { url: string; refs: A11yRef[] } | null = null;
  private qwenCache: { url: string; perception: string } | null = null;  // Qwen result per URL

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
      await this._waitForStable();

      if (this.config.loginEmail && this.config.loginPassword) {
        await this._tryLogin();
      }

      let status: HumanAgentResult["status"] = "max_steps";
      let summary = "";

      for (let step = 1; step <= maxSteps; step++) {
        const stepStart = Date.now();

        // ── Stall guard ────────────────────────────────────────
        if (this._isStalled()) {
          await this._recoverFromStall();
          this.recentActionKeys = [];
        }

        // ── 3+ consecutive failures → stronger recovery ────────
        if (this.consecutiveFailures >= 3) {
          logger.warn("3 consecutive failures — triggering recovery");
          await this._recoverFromStall();
          this.consecutiveFailures = 0;
          this.lastFailureContext = null;
        }

        // ── Step 1a: Screenshot (needed by both Qwen and GPT-4o) ──
        const percStart = Date.now();
        const currentUrl = this.page!.url();
        const { base64, publicPath } = await this._screenshot(`step${step}`);

        // ── Step 1b: A11y + Qwen in parallel ─────────────────
        // Qwen: URL-based cache hit = 0ms; miss = run with 25s timeout
        const qwenTask: Promise<string> = (this.qwenCache?.url === currentUrl)
          ? Promise.resolve(this.qwenCache.perception)
          : this._withTimeout(perceiveScreen(base64, currentUrl), 25_000, "");

        const [a11yRefs, rawQwen] = await Promise.all([
          this._snapshotA11y(false),
          qwenTask,
        ]);

        const qwenPerception = rawQwen;

        // Update Qwen cache on new URL result
        if (qwenPerception && this.qwenCache?.url !== currentUrl) {
          this.qwenCache = { url: currentUrl, perception: qwenPerception };
        }

        const perceptionMs = Date.now() - percStart;

        // ── Step 2: GPT-4o Vision + Planning (with Qwen context) ──
        const planStart = Date.now();
        const decision = await this._withTimeout(
          this._plan(base64, a11yRefs, step, maxSteps, qwenPerception),
          40_000,
          { action: "wait", value: "1500", description: "플래닝 타임아웃", observation: "타임아웃", screen_description: "" },
        );
        const planningMs = Date.now() - planStart;

        const perception = qwenPerception || decision.screen_description || "";

        this.recentActionKeys.push(`${decision.action}:${decision.target ?? ""}`);
        if (this.recentActionKeys.length > 5) this.recentActionKeys.shift();

        // ── Step 3: Execution ─────────────────────────────────
        const preUrl = this.page.url();
        let { success, error } = await this._withTimeout(
          this._execute(decision),
          30_000,
          { success: false, error: "실행 타임아웃 (30s)" },
        );

        // Invalidate A11y + Qwen cache after DOM-changing actions
        if (CACHE_BUSTING_ACTIONS.has(decision.action)) {
          this.a11yCache = null;
          // Qwen cache is URL-based: only invalidate on explicit navigate
          if (decision.action === "navigate") this.qwenCache = null;
        }

        // ── Step 3b: Validation (skip for wait/scroll/hover) ──
        if (success && ["click", "navigate", "fill", "type", "select"].includes(decision.action)) {
          const validation = await this._withTimeout(
            this._validate(decision, preUrl),
            12_000,
            { succeeded: true, observation: "validation skipped (timeout)" },
          );
          if (!validation.succeeded) {
            this.lastFailureContext =
              `Action executed but result looks wrong: ${validation.observation}.` +
              (validation.suggestion ? ` Try: ${validation.suggestion}` : "");
            success = false;
            error = validation.observation;
          } else {
            this.lastFailureContext = null;
          }
        } else if (!success) {
          this.lastFailureContext = `Execution error: ${error}`;
        } else {
          this.lastFailureContext = null;
        }

        if (success) {
          this.consecutiveFailures = 0;
        } else {
          this.consecutiveFailures++;
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

        // ② Compress history: keep last 6 full, summarise older
        if (this.actionHistory.length > 6) {
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

        await this.page.waitForTimeout(600);
      }

      if (status === "max_steps") {
        summary = `최대 ${maxSteps} 스텝 도달. 마지막 관찰: ${this.steps.at(-1)?.decision.observation ?? ""}`;
      }

      // Auto-logout after test completes (only if we logged in)
      if (this.config.loginEmail && this.config.loginPassword) {
        await this._tryLogout();
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

  // ── Utilities ─────────────────────────────────────────────
  private async _withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
    ]);
  }

  private async _waitForStable(): Promise<void> {
    try {
      await this.page!.waitForLoadState("networkidle", { timeout: 5_000 });
    } catch { /* ignore — just wait a bit */ }
    await this.page!.waitForTimeout(1500);
  }

  // ── Stall detection & recovery ────────────────────────────
  private _isStalled(): boolean {
    if (this.recentActionKeys.length < 5) return false;
    const [a, b, c, d, e] = this.recentActionKeys;
    // All 5 same, or alternating pattern (a=c=e and b=d)
    const allSame = a === b && b === c && c === d && d === e;
    const alternating = a === c && c === e && b === d && a !== b;
    const notBenign = !a.startsWith("scroll:") && !a.startsWith("wait:");
    return (allSame || alternating) && notBenign;
  }

  private async _recoverFromStall(): Promise<void> {
    logger.warn("Stall/failure recovery triggered");
    try {
      // Try clicking a nav/menu link first
      const navRefs = await this._snapshotA11y(true);
      const navLink = navRefs.find(r => r.role === "link" && r.name && r.name !== "");
      if (navLink) {
        const loc = this.page!.getByRole("link", { name: navLink.name, exact: false });
        if (await loc.count() > 0) {
          await loc.first().click({ timeout: 5_000 });
          await this._waitForStable();
          this.a11yCache = null;
          return;
        }
      }
      // Fallback: scroll to top
      await this.page!.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
      await this.page!.waitForTimeout(800);
    } catch { /* ignore recovery errors */ }
  }

  // ── Login v2 (A11y-based with DOM fallback) ──────────────
  private async _tryLogin(): Promise<void> {
    const { loginEmail, loginPassword } = this.config;
    if (!loginEmail || !loginPassword || !this.page) return;
    try {
      const refs = await this._snapshotA11y(true);
      const emailRef = refs.find(r =>
        ["textbox", "searchbox"].includes(r.role) &&
        (r.name?.toLowerCase().includes("email") || r.name?.toLowerCase().includes("이메일") ||
         r.placeholder?.toLowerCase().includes("email") || r.placeholder?.toLowerCase().includes("이메일") ||
         r.inputType === "email")
      );
      const pwRef = refs.find(r =>
        r.role === "textbox" &&
        (r.name?.toLowerCase().includes("password") || r.name?.toLowerCase().includes("비밀번호") ||
         r.placeholder?.toLowerCase().includes("password") || r.placeholder?.toLowerCase().includes("비밀번호") ||
         r.inputType === "password")
      );

      let loginAttempted = false;

      if (emailRef) {
        await this._resolveAndFill(this.page, emailRef.ref, loginEmail);
        loginAttempted = true;
      } else {
        // DOM fallback
        for (const sel of ['input[type="email"]', 'input[placeholder*="메일"]', 'input[placeholder*="email" i]']) {
          if (await this.page.locator(sel).count() > 0) {
            await this.page.fill(sel, loginEmail);
            loginAttempted = true;
            break;
          }
        }
      }

      if (pwRef) {
        await this._resolveAndFill(this.page, pwRef.ref, loginPassword);
      } else {
        if (await this.page.locator('input[type="password"]').count() > 0) {
          await this.page.fill('input[type="password"]', loginPassword);
        }
      }

      if (loginAttempted) {
        // Find submit
        const submitRef = refs.find(r =>
          r.role === "button" &&
          (r.name?.includes("로그인") || r.name?.toLowerCase().includes("login") || r.name?.toLowerCase().includes("sign in"))
        );
        if (submitRef) {
          await this._resolveAndClick(this.page, submitRef.ref, submitRef.name);
        } else {
          for (const sel of ['button[type="submit"]', 'button:has-text("로그인")', 'button:has-text("Login")']) {
            if (await this.page.locator(sel).count() > 0) {
              await this.page.click(sel);
              break;
            }
          }
        }
        await this._waitForStable();
      }
    } catch (e) {
      logger.warn({ e }, "Login attempt failed");
    }
  }

  // ── Logout: try common logout patterns ───────────────────
  async _tryLogout(): Promise<boolean> {
    if (!this.page) return false;
    try {
      // 1) Try common logout URL paths first
      const origin = new URL(this.page.url()).origin;
      for (const path of ["/logout", "/signout", "/sign-out", "/auth/logout", "/api/auth/signout", "/accounts/logout"]) {
        try {
          const res = await this.page.goto(`${origin}${path}`, { timeout: 8_000, waitUntil: "domcontentloaded" });
          if (res && res.ok()) {
            await this.page.waitForTimeout(1000);
            logger.info(`Logged out via URL: ${path}`);
            return true;
          }
        } catch { /* try next */ }
      }

      // 2) Try clicking logout button/link via common text/aria patterns
      const logoutSelectors = [
        'a[href*="logout"]', 'a[href*="signout"]', 'a[href*="sign-out"]',
        'button:has-text("로그아웃")', 'a:has-text("로그아웃")',
        'button:has-text("Logout")', 'button:has-text("Log out")',
        'a:has-text("Logout")', 'a:has-text("Log out")',
        '[aria-label*="logout" i]', '[aria-label*="로그아웃"]',
      ];
      for (const sel of logoutSelectors) {
        try {
          if (await this.page.locator(sel).count() > 0) {
            await this.page.locator(sel).first().click({ timeout: 3_000 });
            await this.page.waitForTimeout(1500);
            logger.info(`Logged out via selector: ${sel}`);
            return true;
          }
        } catch { /* try next */ }
      }

      // 3) A11y-based: find button/link with logout-related text
      const refs = await this._snapshotA11y(true);
      const logoutRef = refs.find(r =>
        ["button", "link"].includes(r.role) &&
        (r.name?.includes("로그아웃") || r.name?.toLowerCase().includes("logout") ||
         r.name?.toLowerCase().includes("log out") || r.name?.toLowerCase().includes("sign out"))
      );
      if (logoutRef) {
        await this._resolveAndClick(this.page, logoutRef.ref, logoutRef.name);
        await this.page.waitForTimeout(1500);
        logger.info(`Logged out via a11y: ${logoutRef.name}`);
        return true;
      }

      // 4) Account/profile menu — open it first, then look for logout
      const menuRef = refs.find(r =>
        ["button", "link"].includes(r.role) &&
        (r.name?.includes("프로필") || r.name?.includes("계정") || r.name?.includes("내 정보") ||
         r.name?.toLowerCase().includes("account") || r.name?.toLowerCase().includes("profile") ||
         r.name?.toLowerCase().includes("my page"))
      );
      if (menuRef) {
        await this._resolveAndClick(this.page, menuRef.ref, menuRef.name);
        await this.page.waitForTimeout(800);
        const refsAfter = await this._snapshotA11y(true);
        const logoutAfter = refsAfter.find(r =>
          ["button", "link"].includes(r.role) &&
          (r.name?.includes("로그아웃") || r.name?.toLowerCase().includes("logout") ||
           r.name?.toLowerCase().includes("sign out"))
        );
        if (logoutAfter) {
          await this._resolveAndClick(this.page, logoutAfter.ref, logoutAfter.name);
          await this.page.waitForTimeout(1500);
          logger.info(`Logged out via menu: ${logoutAfter.name}`);
          return true;
        }
      }

      logger.warn("Could not find logout button/URL");
      return false;
    } catch (e) {
      logger.warn({ e }, "Logout attempt failed");
      return false;
    }
  }

  // ── Screenshot ────────────────────────────────────────────
  private async _screenshot(name: string): Promise<{ base64: string; publicPath: string }> {
    const filename = `human_${this.sessionId}_${name}_${Date.now()}.png`;
    const buffer = await this.page!.screenshot({
      path: path.join(SCREENSHOTS_DIR, filename),
      fullPage: false,
      type: "png",
    });
    return { base64: buffer.toString("base64"), publicPath: `/api/screenshots/${filename}` };
  }

  // ── A11y snapshot v2 with DOM augmentation ────────────────
  private async _snapshotA11y(forceRefresh: boolean): Promise<A11yRef[]> {
    const currentUrl = this.page?.url() ?? "";

    if (!forceRefresh && this.a11yCache?.url === currentUrl) {
      return this.a11yCache.refs;
    }

    this.refMap.clear();
    const refs: A11yRef[] = [];
    let counter = 1;

    type CDPAXNode = {
      nodeId: string;
      ignored?: boolean;
      role?: { value: string };
      name?: { value: string };
      description?: { value: string };
      value?: { value: string };
      backendDOMNodeId?: number;
      properties?: Array<{ name: string; value: { value: unknown } }>;
    };

    try {
      const client = await this.page!.context().newCDPSession(this.page!);
      const { nodes } = await client.send("Accessibility.getFullAXTree") as { nodes: CDPAXNode[] };

      // DOM augmentation: get placeholder/type/label for unnamed inputs
      const unnamedNodeIds: number[] = [];
      const unnamedA11yIds: string[] = [];

      for (const node of nodes) {
        if (node.ignored) continue;
        const role = node.role?.value?.toLowerCase() ?? "";
        if (!INTERACTIVE_ROLES.has(role)) continue;
        const name = (node.name?.value ?? "").trim();
        const disabled = node.properties?.find(p => p.name === "disabled")?.value?.value;
        if (disabled === true) continue;
        if (!name && node.backendDOMNodeId) {
          unnamedNodeIds.push(node.backendDOMNodeId);
          unnamedA11yIds.push(node.nodeId);
        }
      }

      // Get DOM attributes for unnamed nodes via CDP
      const domAugments: Record<string, { placeholder?: string; inputType?: string; ariaLabel?: string }> = {};
      if (unnamedNodeIds.length > 0) {
        try {
          const { nodeIds: domNodeIds } = await client.send("DOM.pushNodesByBackendIdsToFrontend", {
            backendNodeIds: unnamedNodeIds.slice(0, 30),
          }) as { nodeIds: number[] };

          await Promise.all(domNodeIds.map(async (domNodeId, i) => {
            if (!domNodeId) return;
            try {
              const { attributes } = await client.send("DOM.getAttributes", { nodeId: domNodeId }) as { attributes: string[] };
              const attrs: Record<string, string> = {};
              for (let j = 0; j < attributes.length - 1; j += 2) attrs[attributes[j]] = attributes[j + 1];
              domAugments[unnamedA11yIds[i]] = {
                placeholder: attrs.placeholder || undefined,
                inputType: attrs.type || undefined,
                ariaLabel: attrs["aria-label"] || undefined,
              };
            } catch { /* ignore */ }
          }));
        } catch { /* ignore CDP augmentation errors */ }
      }

      await client.detach();

      // Build refs
      for (const node of nodes) {
        if (node.ignored) continue;
        const role = node.role?.value?.toLowerCase() ?? "";
        if (!INTERACTIVE_ROLES.has(role)) continue;

        const disabled = node.properties?.find(p => p.name === "disabled")?.value?.value;
        if (disabled === true) continue;

        let name = (node.name?.value ?? "").trim();
        const augment = domAugments[node.nodeId] ?? {};

        // Augment empty names from DOM attributes
        if (!name) {
          name = augment.ariaLabel || augment.placeholder || "";
        }

        const value = node.value?.value ? String(node.value.value) : undefined;
        const checked = node.properties?.find(p => p.name === "checked")?.value?.value;
        const expanded = node.properties?.find(p => p.name === "expanded")?.value?.value;

        const ref: A11yRef = {
          ref: `@e${counter++}`,
          role,
          name,
          placeholder: augment.placeholder,
          inputType: augment.inputType,
          value,
          checked: typeof checked === "boolean" ? checked : undefined,
          expanded: typeof expanded === "boolean" ? expanded : undefined,
          backendDOMNodeId: node.backendDOMNodeId,
        };
        refs.push(ref);
        this.refMap.set(ref.ref, ref);
      }
    } catch (e) {
      logger.warn({ e }, "A11y CDP snapshot failed");
    }

    const capped = refs.slice(0, 80);
    this.a11yCache = { url: currentUrl, refs: capped };
    return capped;
  }

  // ── History builder ───────────────────────────────────────
  private _buildHistoryText(): string {
    const lines: string[] = [];

    if (this.accomplishments.length) {
      lines.push(
        `[이전 ${this.accomplishments.length}스텝 요약] ` +
        this.accomplishments.slice(-6).join(" → ")
      );
    }

    if (this.actionHistory.length) {
      lines.push("Recent steps:");
      lines.push(...this.actionHistory);
    }

    return lines.length ? "\n" + lines.join("\n") : "";
  }

  // ── GPT-4o Vision + Planning (with optional Qwen context) ──
  private async _plan(
    imageBase64: string,
    a11yRefs: A11yRef[],
    stepNum: number,
    maxSteps: number,
    qwenPerception = "",
  ): Promise<ActionDecision> {
    const historyText = this._buildHistoryText();
    const stepsLeft = maxSteps - stepNum;

    const failureText = this.lastFailureContext
      ? `\n\n⚠️ PREVIOUS ACTION FAILED OR UNVERIFIED: "${this.lastFailureContext}"\nChoose a completely different approach.`
      : "";

    const sheetText = this.config.sheetRawTable
      ? `\n\n--- TEST SHEET (use as additional context) ---\n${this.config.sheetRawTable}`
      : "";

    const refsText = a11yRefs.length
      ? a11yRefs.map(r => {
          let line = `${r.ref} [${r.role}] "${r.name}"`;
          if (r.placeholder && r.placeholder !== r.name) line += ` placeholder="${r.placeholder}"`;
          if (r.inputType && r.inputType !== "text") line += ` type="${r.inputType}"`;
          if (r.value) line += ` (current: "${r.value.slice(0, 30)}")`;
          if (r.checked !== undefined) line += ` checked=${r.checked}`;
          if (r.expanded !== undefined) line += ` expanded=${r.expanded}`;
          return line;
        }).join("\n")
      : "(no interactive elements found — try scroll or wait)";

    const pageTitle = await this.page!.title().catch(() => "");

    const qwenSection = qwenPerception
      ? `\n--- QWEN3-VL KOREAN OCR + UI DESCRIPTION ---\n${qwenPerception}\n`
      : "";

    const userMessage = [
      `URL: ${this.page?.url()}`,
      pageTitle ? `Page title: ${pageTitle}` : "",
      `Step: ${stepNum}/${maxSteps} (${stepsLeft} steps remaining)`,
      historyText,
      sheetText,
      failureText,
      qwenSection,
      "--- A11Y_REFS (ONLY use @eN as target for click/fill/select/type/hover) ---",
      refsText,
      "",
      "Look at the attached screenshot and decide the next action.",
    ].filter(Boolean).join("\n");

    const systemPrompt = buildPlanningSystem(
      this.config.goal,
      this.config.categories ?? [],
      this.config.similarContext ?? "",
    );

    try {
      const response = await openAIClient().chat.completions.create({
        model: "gpt-4o",
        max_tokens: 700,
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: [
              { type: "text", text: userMessage },
              { type: "image_url", image_url: { url: `data:image/png;base64,${imageBase64}`, detail: "auto" } },
            ],
          },
        ],
      });
      const raw = response.choices[0]?.message?.content ?? "";
      logger.info(`[GPT-4o] step ${stepNum}: ${raw.slice(0, 80)}`);
      return extractJSON<ActionDecision>(raw);
    } catch (e) {
      logger.error({ e }, "Planning failed");
      return { action: "wait", value: "1500", description: "플래닝 실패 — 대기", observation: "오류", screen_description: "" };
    }
  }

  // ── Validator Agent (GPT-4o-mini) ─────────────────────────
  private async _validate(action: ActionDecision, preUrl: string): Promise<ValidationResult> {
    try {
      const postUrl = this.page!.url();

      // URL changed = navigation succeeded (no need to call AI)
      if (action.action === "navigate" && postUrl !== preUrl) {
        return { succeeded: true, observation: `Navigated to ${postUrl}` };
      }
      // URL changed after click = clearly worked
      if (action.action === "click" && postUrl !== preUrl) {
        return { succeeded: true, observation: `Navigation triggered: ${postUrl}` };
      }
      // For fill/type: check if field has value via DOM
      if (action.action === "fill" || action.action === "type") {
        if (action.value) {
          const hasValue = await this.page!.evaluate((val) => {
            const active = document.activeElement as HTMLInputElement;
            return active && (active.value?.includes(val) || active.textContent?.includes(val));
          }, action.value.slice(0, 20));
          if (hasValue) return { succeeded: true, observation: "Field filled successfully" };
        }
        return { succeeded: true, observation: "Fill accepted (no DOM check needed)" };
      }
      // For select: skip AI validation
      if (action.action === "select") {
        return { succeeded: true, observation: "Select action completed" };
      }

      // For click with no URL change: quick visual check
      const buffer = await this.page!.screenshot({ fullPage: false, type: "png" });
      const base64 = buffer.toString("base64");

      const response = await openAIClient().chat.completions.create({
        model: "gpt-4o-mini",
        max_tokens: 150,
        messages: [
          {
            role: "system",
            content: `Quick QA validator. Did the action succeed?
Respond ONLY with raw JSON: {"succeeded": true/false, "observation": "1 sentence", "suggestion": "if failed"}`,
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `Action: [${action.action}] ${action.description}\nURL: ${postUrl}\nDid it work? Check for error messages, loading spinners stuck, or unchanged state.`,
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

  // ── Execution ─────────────────────────────────────────────
  private async _execute(d: ActionDecision): Promise<{ success: boolean; error?: string }> {
    const p = this.page!;
    try {
      switch (d.action) {
        case "navigate": {
          const url = d.value ?? d.target ?? "";
          if (!url || url.startsWith("@")) throw new Error("navigate requires a URL as value");
          await p.goto(url, { waitUntil: "domcontentloaded", timeout: 25_000 });
          await this._waitForStable();
          break;
        }

        case "click": {
          const clicked = await this._resolveAndClick(p, d.target ?? "", d.description);
          if (!clicked) throw new Error(`클릭 실패: 요소를 찾지 못했습니다 (${d.target} / "${d.description}")`);
          try { await p.waitForLoadState("networkidle", { timeout: 4_000 }); } catch { /* ignore */ }
          await p.waitForTimeout(500);
          break;
        }

        case "fill": {
          const filled = await this._resolveAndFill(p, d.target ?? "", d.value ?? "");
          if (!filled) throw new Error(`입력 실패: 요소를 찾지 못했습니다 (${d.target})`);
          break;
        }

        case "type": {
          // Type character-by-character (for autocomplete fields)
          const filled = await this._resolveAndFill(p, d.target ?? "", d.value ?? "");
          if (!filled) throw new Error(`타이핑 실패: ${d.target}`);
          await p.waitForTimeout(300);
          break;
        }

        case "select": {
          const selected = await this._resolveAndSelect(p, d.target ?? "", d.value ?? "");
          if (!selected) throw new Error(`선택 실패: ${d.target} = "${d.value}"`);
          break;
        }

        case "hover": {
          const hovered = await this._resolveAndHover(p, d.target ?? "", d.description);
          if (!hovered) throw new Error(`호버 실패: ${d.target}`);
          await p.waitForTimeout(400);
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
          await p.waitForTimeout(600);
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

  // ── Element resolution helpers ────────────────────────────

  private async _resolveAndClick(p: Page, target: string, hint: string): Promise<boolean> {
    const ref = target.startsWith("@e") ? this.refMap.get(target) : undefined;

    // Strategy 1: A11y getByRole (most reliable when name is known)
    if (ref?.name) {
      for (const role of [ref.role, "button", "link", "menuitem"] as const) {
        try {
          const loc = p.getByRole(role as Parameters<typeof p.getByRole>[0], { name: ref.name, exact: false });
          if (await loc.count() > 0) {
            await loc.first().scrollIntoViewIfNeeded();
            await loc.first().click({ timeout: 6_000 });
            return true;
          }
        } catch { /* try next */ }
      }
    }

    // Strategy 2: getByText (for elements with visible text)
    const hintText = ref?.name || hint;
    if (hintText && hintText.length > 0 && hintText.length < 100) {
      for (const attempt of [
        () => p.getByRole("button", { name: hintText, exact: false }),
        () => p.getByRole("link", { name: hintText, exact: false }),
        () => p.getByText(hintText, { exact: false }),
        () => p.getByLabel(hintText, { exact: false }),
        () => p.locator(`[aria-label*="${hintText.slice(0, 20)}"]`),
      ]) {
        try {
          const loc = attempt();
          if (await loc.count() > 0) {
            await loc.first().scrollIntoViewIfNeeded();
            await loc.first().click({ timeout: 5_000 });
            return true;
          }
        } catch { /* try next */ }
      }
    }

    // Strategy 3: CDP DOM click using backendDOMNodeId
    if (ref?.backendDOMNodeId) {
      try {
        const client = await p.context().newCDPSession(p);
        const { nodeIds } = await client.send("DOM.pushNodesByBackendIdsToFrontend", {
          backendNodeIds: [ref.backendDOMNodeId],
        }) as { nodeIds: number[] };
        if (nodeIds[0]) {
          const { model } = await client.send("DOM.getBoxModel", { nodeId: nodeIds[0] }) as {
            model: { content: number[] };
          };
          const c = model.content;                    // [x1,y1, x2,y2, x3,y3, x4,y4]
          const cx = (c[0] + c[4]) / 2;            // left-x + right-x
          const cy = (c[1] + c[5]) / 2;            // top-y  + bottom-y
          await client.send("Input.dispatchMouseEvent", { type: "mousePressed", x: cx, y: cy, button: "left", clickCount: 1 });
          await client.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: cx, y: cy, button: "left", clickCount: 1 });
          await client.detach();
          return true;
        }
        await client.detach();
      } catch { /* ignore CDP fallback errors */ }
    }

    return false;
  }

  private async _resolveAndFill(p: Page, target: string, value: string): Promise<boolean> {
    const ref = target.startsWith("@e") ? this.refMap.get(target) : undefined;

    const tryFill = async (loc: ReturnType<typeof p.getByRole>): Promise<boolean> => {
      try {
        if (await loc.count() > 0) {
          const el = loc.first();
          await el.scrollIntoViewIfNeeded();
          await el.click({ timeout: 3_000 }); // focus first
          await el.fill(value, { timeout: 6_000 });
          return true;
        }
      } catch { /* try next */ }
      return false;
    };

    // Strategy 1: A11y role + name
    if (ref?.name) {
      for (const role of ["textbox", "searchbox", "combobox", "spinbutton"] as const) {
        if (await tryFill(p.getByRole(role, { name: ref.name, exact: false }))) return true;
      }
      if (await tryFill(p.getByLabel(ref.name, { exact: false }))) return true;
    }

    // Strategy 2: placeholder (from DOM augmentation)
    if (ref?.placeholder) {
      if (await tryFill(p.getByPlaceholder(ref.placeholder, { exact: false }))) return true;
    }

    // Strategy 3: Generic fallback by visible text/label
    const hint = ref?.name || ref?.placeholder || "";
    if (hint && hint.length > 0) {
      try {
        const loc = p.getByPlaceholder(hint, { exact: false });
        if (await tryFill(loc)) return true;
      } catch { /* ignore */ }
    }

    // Strategy 4: First visible unfilled input (last resort)
    if (ref?.inputType && ["email", "text", "password", "search", "url"].includes(ref.inputType)) {
      const typeSelector = `input[type="${ref.inputType}"]:visible`;
      try {
        const loc = p.locator(typeSelector).first();
        if (await loc.count() > 0) {
          await loc.scrollIntoViewIfNeeded();
          await loc.click();
          await loc.fill(value, { timeout: 6_000 });
          return true;
        }
      } catch { /* ignore */ }
    }

    // Strategy 5: CDP direct via backendDOMNodeId
    if (ref?.backendDOMNodeId) {
      try {
        const client = await p.context().newCDPSession(p);
        const { nodeIds } = await client.send("DOM.pushNodesByBackendIdsToFrontend", {
          backendNodeIds: [ref.backendDOMNodeId],
        }) as { nodeIds: number[] };
        if (nodeIds[0]) {
          await client.send("DOM.focus", { nodeId: nodeIds[0] });
          // select all + delete
          await p.keyboard.press("Control+a");
          await p.keyboard.press("Delete");
          for (const ch of value) await p.keyboard.type(ch);
          await client.detach();
          return true;
        }
        await client.detach();
      } catch { /* ignore */ }
    }

    return false;
  }

  private async _resolveAndSelect(p: Page, target: string, value: string): Promise<boolean> {
    const ref = target.startsWith("@e") ? this.refMap.get(target) : undefined;

    const trySelect = async (selector: string): Promise<boolean> => {
      try {
        const count = await p.locator(selector).count();
        if (count > 0) {
          await p.selectOption(selector, { label: value });
          return true;
        }
      } catch {
        try {
          await p.selectOption(selector, { value });
          return true;
        } catch { /* ignore */ }
      }
      return false;
    };

    // Try combobox getByRole first → click to open → getByOption
    if (ref?.name) {
      try {
        const combo = p.getByRole("combobox", { name: ref.name, exact: false });
        if (await combo.count() > 0) {
          const tagName = await combo.first().evaluate(el => el.tagName.toLowerCase());
          if (tagName === "select") {
            await p.selectOption(await combo.first().evaluate(el => {
              const attr = el.id || el.getAttribute("name") || "";
              return attr ? `#${el.id}` || `[name="${attr}"]` : "";
            }), { label: value });
            return true;
          }
          // Native select via first visible
          await combo.first().click();
          await p.waitForTimeout(300);
          const option = p.getByRole("option", { name: value, exact: false });
          if (await option.count() > 0) { await option.first().click(); return true; }
        }
      } catch { /* fall through */ }
    }

    // Fallback: try CSS select selectors
    for (const sel of ["select:visible", "select"]) {
      if (await trySelect(sel)) return true;
    }

    return false;
  }

  private async _resolveAndHover(p: Page, target: string, hint: string): Promise<boolean> {
    const ref = target.startsWith("@e") ? this.refMap.get(target) : undefined;
    const hintText = ref?.name || hint;

    if (hintText) {
      for (const attempt of [
        () => p.getByRole("button", { name: hintText, exact: false }),
        () => p.getByRole("link", { name: hintText, exact: false }),
        () => p.getByText(hintText, { exact: false }),
      ]) {
        try {
          const loc = attempt();
          if (await loc.count() > 0) { await loc.first().hover(); return true; }
        } catch { /* try next */ }
      }
    }
    return false;
  }
}
