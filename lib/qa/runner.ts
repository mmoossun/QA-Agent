/**
 * QA Execution Engine — Playwright-based dynamic test runner
 * Features:
 * - Multi-strategy selector with auto-healing
 * - Retry logic with exponential backoff
 * - Flaky test detection
 * - Screenshot on key steps and failures
 * - Performance timing
 */

import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import * as path from "path";
import * as fs from "fs";
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

    const contextOptions: Parameters<Browser["newContext"]>[0] = {
      viewport: { width: 1440, height: 900 },
      locale: "ko-KR",
      timezoneId: "Asia/Seoul",
    };

    if (this.opts.authState && fs.existsSync(this.opts.authState)) {
      contextOptions.storageState = this.opts.authState;
    }

    this.context = await this.browser.newContext(contextOptions);
    this.context.setDefaultTimeout(this.opts.timeout);
  }

  async close(): Promise<void> {
    await this.context?.close();
    await this.browser?.close();
  }

  // ─── Persist auth state for reuse ─────────────────────────
  async saveAuthState(filePath: string): Promise<void> {
    await this.context?.storageState({ path: filePath });
  }

  // ─── Login helper ─────────────────────────────────────────
  async performLogin(page: Page): Promise<void> {
    const { loginEmail, loginPassword, baseUrl } = this.config;
    if (!loginEmail || !loginPassword) return;

    await page.goto(`${baseUrl}/login`, { waitUntil: "networkidle" });

    // Try multiple email field selectors
    for (const sel of [
      'input[type="email"]',
      'input[name="email"]',
      'input[placeholder*="email" i]',
      'input[placeholder*="이메일"]',
    ]) {
      if ((await page.locator(sel).count()) > 0) {
        await page.fill(sel, loginEmail);
        break;
      }
    }

    for (const sel of ['input[type="password"]', 'input[name="password"]']) {
      if ((await page.locator(sel).count()) > 0) {
        await page.fill(sel, loginPassword);
        break;
      }
    }

    for (const sel of [
      'button[type="submit"]',
      'button:has-text("Login")',
      'button:has-text("로그인")',
      'button:has-text("Sign in")',
    ]) {
      if ((await page.locator(sel).count()) > 0) {
        await page.click(sel);
        break;
      }
    }

    await page.waitForLoadState("networkidle");
    logger.info({ email: loginEmail }, "Login performed");
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

      // Classify failure
      if (result.failureCategory === "real_bug") break; // Don't retry real bugs
    }

    return this._buildFailResult(scenario, runId, lastError ?? "Max retries exceeded");
  }

  private async _runScenarioOnce(
    scenario: QAScenario,
    runId: string,
    attempt: number
  ): Promise<TestResult> {
    const page = await this.context!.newPage();
    const stepResults: StepResult[] = [];
    const startTime = Date.now();
    let scenarioScreenshot: string | undefined;

    try {
      // Login if needed
      if (this.config.loginEmail) {
        await this.performLogin(page);
      }

      // Navigate to base URL first
      if (!page.url().includes(this.config.baseUrl)) {
        await page.goto(this.config.baseUrl, { waitUntil: "networkidle" });
      }

      // Execute each step
      for (const step of scenario.steps) {
        const stepResult = await this._executeStep(page, step, runId);
        stepResults.push(stepResult);

        if (stepResult.status === "fail") {
          // Capture failure screenshot
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
    }
  }

  private async _executeStep(page: Page, step: QAStep, runId: string): Promise<StepResult> {
    const start = Date.now();
    let screenshot: string | undefined;

    try {
      switch (step.action) {
        case "navigate":
          const url = step.value?.startsWith("http")
            ? step.value
            : `${this.config.baseUrl}${step.value ?? ""}`;
          await page.goto(url, { waitUntil: "networkidle" });
          break;

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
              throw new Error(`Assertion failed: expected "${step.value}" in "${text}"`);
            }
          }
          break;
        }

        case "wait":
          await page.waitForTimeout(Number(step.value ?? 1000));
          break;

        case "screenshot":
          screenshot = await this._screenshot(page, `${runId}_step`);
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
