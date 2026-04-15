/**
 * QA Execution Engine — Playwright-based dynamic test runner
 * Features:
 * - Multi-strategy selector with auto-healing
 * - Auth state caching (login once, reuse across all scenarios)
 * - Retry logic with exponential backoff
 * - Flaky test detection
 * - Screenshot on key steps and failures
 * - Performance timing
 */

import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { v4 as uuidv4 } from "uuid";
import type { QAScenario, QAStep, TestResult, StepResult } from "@/lib/ai/types";
import { resolveSelector } from "./selector";
import { logger } from "@/lib/logger";

const SCREENSHOTS_DIR = path.join(process.cwd(), "public", "screenshots");
fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

export interface RunnerOptions {
  headless?: boolean;
  slowMo?: number;
  timeout?: number;
  maxRetries?: number;
  screenshotOnStep?: boolean;
  authState?: string; // path to saved auth state JSON
}

export interface RunnerConfig {
  baseUrl: string;
  loginEmail?: string;
  loginPassword?: string;
  options?: RunnerOptions;
}

// ─── QA Runner Class ──────────────────────────────────────────
export class QARunner {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private config: RunnerConfig;
  private opts: Required<RunnerOptions>;
  private authStatePath: string | null = null;

  constructor(config: RunnerConfig) {
    this.config = config;
    this.opts = {
      headless: process.env.PLAYWRIGHT_HEADLESS !== "false",
      slowMo: Number(process.env.PLAYWRIGHT_SLOW_MO ?? 0),
      timeout: 30_000,
      maxRetries: 2,
      screenshotOnStep: false,
      authState: "",
      ...config.options,
    };
  }

  async init(): Promise<void> {
    this.browser = await chromium.launch({
      headless: this.opts.headless,
      slowMo: this.opts.slowMo,
    });

    // If we have credentials, do a single login and cache auth state
    if (this.config.loginEmail && this.config.loginPassword) {
      await this._initAuthState();
    }

    await this._createContext();
  }

  /** Login once in a temporary context, save storageState, then close */
  private async _initAuthState(): Promise<void> {
    const tmpContext = await this.browser!.newContext({
      viewport: { width: 1440, height: 900 },
      locale: "ko-KR",
      timezoneId: "Asia/Seoul",
    });
    const page = await tmpContext.newPage();

    try {
      await this._performLoginOnPage(page);
      // Save auth cookies/storage to temp file
      this.authStatePath = path.join(os.tmpdir(), `qa_auth_${uuidv4().slice(0, 8)}.json`);
      await tmpContext.storageState({ path: this.authStatePath });
      logger.info({ path: this.authStatePath }, "Auth state cached");
    } catch (err) {
      logger.warn({ err }, "Auth state caching failed — will login per scenario");
      this.authStatePath = null;
    } finally {
      await page.close();
      await tmpContext.close();
    }
  }

  private async _createContext(): Promise<void> {
    const contextOptions: Parameters<Browser["newContext"]>[0] = {
      viewport: { width: 1440, height: 900 },
      locale: "ko-KR",
      timezoneId: "Asia/Seoul",
    };

    // Use cached auth state if available
    const statePath = this.authStatePath ?? (this.opts.authState && fs.existsSync(this.opts.authState) ? this.opts.authState : null);
    if (statePath) {
      contextOptions.storageState = statePath;
    }

    this.context = await this.browser!.newContext(contextOptions);
    this.context.setDefaultTimeout(this.opts.timeout);
  }

  async close(): Promise<void> {
    await this.context?.close();
    await this.browser?.close();
    // Clean up temp auth file
    if (this.authStatePath && fs.existsSync(this.authStatePath)) {
      fs.unlinkSync(this.authStatePath);
    }
  }

  async saveAuthState(filePath: string): Promise<void> {
    await this.context?.storageState({ path: filePath });
  }

  /** Perform login on a given page, returning after successful auth redirect */
  private async _performLoginOnPage(page: Page): Promise<void> {
    const { loginEmail, loginPassword, baseUrl } = this.config;
    if (!loginEmail || !loginPassword) return;

    // Navigate to baseUrl (ZeroTalk login is at root, not /login)
    await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });

    // If already logged in (redirected away from login page), skip
    if (!page.url().includes(baseUrl.replace(/\/$/, "")) ||
        (await page.locator('input[type="password"]').count()) === 0) {
      // Try navigating to a login-specific path if available
      const loginUrl = `${baseUrl}/login`;
      try {
        await page.goto(loginUrl, { waitUntil: "domcontentloaded", timeout: 10_000 });
        if ((await page.locator('input[type="password"]').count()) === 0) {
          // Go back to base
          await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 15_000 });
        }
      } catch {
        await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 15_000 });
      }
    }

    // Fill email
    for (const sel of [
      'input[type="email"]',
      'input[name="email"]',
      'input[placeholder*="이메일"]',
      'input[placeholder*="email" i]',
    ]) {
      if ((await page.locator(sel).count()) > 0) {
        await page.fill(sel, loginEmail);
        break;
      }
    }

    // Fill password
    for (const sel of ['input[type="password"]', 'input[name="password"]']) {
      if ((await page.locator(sel).count()) > 0) {
        await page.fill(sel, loginPassword);
        break;
      }
    }

    // Submit
    for (const sel of [
      'button[type="submit"]',
      'button:has-text("로그인")',
      'button:has-text("Login")',
      'button:has-text("Sign in")',
    ]) {
      if ((await page.locator(sel).count()) > 0) {
        await page.click(sel);
        break;
      }
    }

    // Wait for post-login navigation (URL should change from login page)
    try {
      await page.waitForFunction(
        () => !document.querySelector('input[type="password"]') ||
              window.location.pathname.length > 1,
        { timeout: 15_000 }
      );
    } catch {
      await page.waitForLoadState("networkidle");
    }

    logger.info({ email: loginEmail, url: page.url() }, "Login performed");
  }

  // ─── Run a single scenario with retry ─────────────────────
  async runScenario(scenario: QAScenario): Promise<TestResult> {
    const runId = uuidv4().slice(0, 8);
    let lastError: string | undefined;

    for (let attempt = 0; attempt <= this.opts.maxRetries; attempt++) {
      if (attempt > 0) {
        const backoff = Math.pow(2, attempt) * 500;
        logger.info({ scenario: scenario.id, attempt, backoff }, "Retrying scenario");
        await new Promise((r) => setTimeout(r, backoff));
      }

      const result = await this._runScenarioOnce(scenario, runId, attempt);
      if (result.status !== "fail" && result.status !== "error") return result;
      lastError = result.errorMessage;

      if (result.failureCategory === "real_bug") break; // Don't retry real bugs
    }

    return this._buildFailResult(scenario, runId, lastError ?? "Max retries exceeded");
  }

  private async _runScenarioOnce(
    scenario: QAScenario,
    runId: string,
    attempt: number
  ): Promise<TestResult> {
    // Auth category scenarios always run in a clean (unauthenticated) context
    // so the login form is visible and can be tested properly.
    const isAuthScenario = scenario.category === "auth" || scenario.category === "security";
    let cleanContext: BrowserContext | null = null;
    let page: Page;

    if (isAuthScenario && this.authStatePath) {
      // Fresh context without auth cookies
      cleanContext = await this.browser!.newContext({
        viewport: { width: 1440, height: 900 },
        locale: "ko-KR",
        timezoneId: "Asia/Seoul",
      });
      cleanContext.setDefaultTimeout(this.opts.timeout);
      page = await cleanContext.newPage();
    } else {
      page = await this.context!.newPage();
    }

    const stepResults: StepResult[] = [];
    const startTime = Date.now();
    let scenarioScreenshot: string | undefined;

    try {
      if (isAuthScenario) {
        // Auth scenarios: start from the unauthenticated login page
        await page.goto(this.config.baseUrl, { waitUntil: "domcontentloaded", timeout: 20_000 });
      } else if (!this.authStatePath && this.config.loginEmail) {
        // No cached auth — login fresh before running
        await this._performLoginOnPage(page);
      } else {
        // Auth cookies set — navigate to base, should redirect to dashboard
        await page.goto(this.config.baseUrl, { waitUntil: "domcontentloaded", timeout: 20_000 });
        if ((await page.locator('input[type="password"]').count()) > 0) {
          await this._performLoginOnPage(page);
        }
      }

      // Execute each step
      for (const step of scenario.steps) {
        const stepResult = await this._executeStep(page, step, runId);
        stepResults.push(stepResult);

        if (stepResult.status === "fail") {
          const ss = await this._screenshot(page, `${runId}_${scenario.id}_fail`);
          stepResult.screenshotPath = ss;
          scenarioScreenshot = ss;
          throw new Error(stepResult.error ?? "Step failed");
        }
      }

      // Final screenshot on success
      scenarioScreenshot = await this._screenshot(page, `${runId}_${scenario.id}_pass`);

      return {
        scenarioId: scenario.id,
        scenarioName: scenario.name,
        status: "pass",
        duration: Date.now() - startTime,
        steps: stepResults,
        screenshotPath: scenarioScreenshot,
        retryCount: attempt,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        scenarioId: scenario.id,
        scenarioName: scenario.name,
        status: "fail",
        duration: Date.now() - startTime,
        steps: stepResults,
        screenshotPath: scenarioScreenshot,
        errorMessage: msg,
        failureCategory: classifyFailure(msg),
        retryCount: attempt,
      };
    } finally {
      await page.close();
      if (cleanContext) await cleanContext.close();
    }
  }

  private async _executeStep(page: Page, step: QAStep, _runId: string): Promise<StepResult> {
    const start = Date.now();
    let screenshot: string | undefined;

    try {
      switch (step.action) {
        case "navigate": {
          const url = step.value?.startsWith("http")
            ? step.value
            : `${this.config.baseUrl}${step.value ?? ""}`;
          await page.goto(url, { waitUntil: "domcontentloaded" });
          break;
        }

        case "click": {
          const loc = await resolveSelector(page, step.target!, step.timeout ?? 10_000);
          await loc.scrollIntoViewIfNeeded();
          await loc.click();
          await page.waitForLoadState("domcontentloaded");
          break;
        }

        case "fill": {
          const loc = await resolveSelector(page, step.target!, step.timeout ?? 10_000);
          await loc.fill(step.value ?? "");
          break;
        }

        case "assert": {
          const loc = await resolveSelector(page, step.target!, step.timeout ?? 10_000);
          await loc.waitFor({ state: "visible", timeout: step.timeout ?? 10_000 });
          if (step.value) {
            const text = await loc.textContent();
            if (!text?.includes(step.value)) {
              throw new Error(`Assertion failed: expected "${step.value}" in "${text?.slice(0, 100)}"`);
            }
          }
          break;
        }

        case "wait":
          await page.waitForTimeout(Number(step.value ?? 1000));
          break;

        case "screenshot":
          screenshot = await this._screenshot(page, `${_runId}_step`);
          break;

        case "scroll":
          await page.evaluate((y) => window.scrollTo(0, y), Number(step.value ?? 500));
          break;

        case "hover": {
          const loc = await resolveSelector(page, step.target!, step.timeout ?? 10_000);
          await loc.hover();
          break;
        }

        case "press":
          await page.keyboard.press(step.value ?? "Enter");
          break;

        case "evaluate":
          await page.evaluate(step.value ?? "");
          break;

        case "waitForUrl":
          // Use "commit" so SPA client-side navigation (history.pushState) is detected.
          // Default "load" never fires again after initial page load in SPAs.
          await page.waitForURL(step.value ?? "**", {
            timeout: step.timeout ?? 25_000,
            waitUntil: "commit",
          });
          break;

        default:
          logger.warn({ action: step.action }, "Unknown step action");
      }

      return { step, status: "pass", duration: Date.now() - start, screenshotPath: screenshot };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      return { step, status: "fail", duration: Date.now() - start, error };
    }
  }

  private async _screenshot(page: Page, name: string): Promise<string> {
    const filename = `${name}_${Date.now()}.png`;
    const filepath = path.join(SCREENSHOTS_DIR, filename);
    await page.screenshot({ path: filepath, fullPage: false });
    return `/screenshots/${filename}`;
  }

  private _buildFailResult(scenario: QAScenario, runId: string, error: string): TestResult {
    return {
      scenarioId: scenario.id,
      scenarioName: scenario.name,
      status: "error",
      duration: 0,
      steps: [],
      errorMessage: error,
      retryCount: this.opts.maxRetries,
    };
  }

  // ─── Run all scenarios ────────────────────────────────────
  async runAll(scenarios: QAScenario[]): Promise<TestResult[]> {
    const sorted = [...scenarios].sort((a, b) => priorityScore(b) - priorityScore(a));
    const results: TestResult[] = [];

    for (const scenario of sorted) {
      logger.info({ id: scenario.id, name: scenario.name }, "Running scenario");
      const result = await this.runScenario(scenario);
      results.push(result);
      logger.info({ id: scenario.id, status: result.status, ms: result.duration }, "Scenario done");
    }

    return results;
  }
}

// ─── Utilities ────────────────────────────────────────────────
function priorityScore(s: QAScenario): number {
  return { critical: 4, high: 3, medium: 2, low: 1 }[s.priority] ?? 0;
}

function classifyFailure(msg: string): TestResult["failureCategory"] {
  if (/selector|locator|element|found/i.test(msg)) return "selector";
  if (/timeout|time out|exceeded/i.test(msg)) return "timing";
  if (/assertion|assert|expected|actual/i.test(msg)) return "assertion";
  if (/network|fetch|api|request/i.test(msg)) return "network";
  return "real_bug";
}
