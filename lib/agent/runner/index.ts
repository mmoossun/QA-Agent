/**
 * Agent Runner — Orchestrates the full autonomous QA loop
 */

import { v4 as uuidv4 } from "uuid";
import { SiteExplorer } from "@/lib/agent/explorer";
import { ScenarioGenerator } from "@/lib/agent/scenario-gen";
import { QARunner } from "@/lib/qa/runner";
import { QAReporter } from "@/lib/agent/reporter";
import type { QAReport, QAScenario, SiteStructure, TestResult } from "@/lib/ai/types";
import { logger } from "@/lib/logger";

export interface AgentRunConfig {
  targetUrl: string;
  loginEmail?: string;
  loginPassword?: string;
  maxScenarios?: number;
  timeBudgetMs?: number;
  onProgress?: (status: AgentStatus) => void;
}

export interface AgentStatus {
  stage: "exploring" | "generating" | "running" | "reporting" | "done" | "error";
  message: string;
  progress: number; // 0-100
  data?: unknown;
}

export class AgentRunner {
  private config: AgentRunConfig;

  constructor(config: AgentRunConfig) {
    this.config = {
      maxScenarios: 15,
      timeBudgetMs: 300_000,
      ...config,
    };
  }

  private emit(status: AgentStatus): void {
    logger.info({ stage: status.stage, progress: status.progress }, status.message);
    this.config.onProgress?.(status);
  }

  async run(): Promise<QAReport> {
    const runId = uuidv4().slice(0, 12);
    const startTime = Date.now();

    // ── Stage 1: Explore ─────────────────────────────────────
    this.emit({ stage: "exploring", message: "Exploring site structure...", progress: 5 });
    const explorer = new SiteExplorer({
      targetUrl: this.config.targetUrl,
      loginEmail: this.config.loginEmail,
      loginPassword: this.config.loginPassword,
      maxRoutes: 15,
      timeBudgetMs: 60_000,
    });

    let structure: SiteStructure;
    try {
      structure = await explorer.explore();
      this.emit({
        stage: "exploring",
        message: `Discovered ${structure.routes.length} routes, ${structure.forms.length} forms`,
        progress: 25,
        data: structure,
      });
    } catch (err) {
      logger.error({ err }, "Exploration failed");
      throw new Error(`Site exploration failed: ${err}`);
    }

    // ── Stage 2: Generate Scenarios ──────────────────────────
    this.emit({ stage: "generating", message: "Generating test scenarios...", progress: 30 });
    const generator = new ScenarioGenerator();
    let scenarios: QAScenario[];

    try {
      scenarios = await generator.generate(structure, this.config.targetUrl);
      scenarios = scenarios.slice(0, this.config.maxScenarios);
      this.emit({
        stage: "generating",
        message: `Generated ${scenarios.length} test scenarios`,
        progress: 45,
        data: scenarios,
      });
    } catch (err) {
      logger.error({ err }, "Scenario generation failed");
      throw new Error(`Scenario generation failed: ${err}`);
    }

    // ── Stage 3: Run Tests ───────────────────────────────────
    this.emit({ stage: "running", message: `Running ${scenarios.length} scenarios...`, progress: 50 });
    const qaRunner = new QARunner({
      baseUrl: this.config.targetUrl,
      loginEmail: this.config.loginEmail,
      loginPassword: this.config.loginPassword,
      options: {
        headless: true,
        maxRetries: 2,
        screenshotOnStep: false,
      },
    });

    let results: TestResult[] = [];
    try {
      await qaRunner.init();
      results = await qaRunner.runAll(scenarios);
      const passed = results.filter((r) => r.status === "pass").length;
      this.emit({
        stage: "running",
        message: `Tests done: ${passed}/${results.length} passed`,
        progress: 85,
        data: results,
      });
    } finally {
      await qaRunner.close();
    }

    // ── Stage 4: Report ──────────────────────────────────────
    this.emit({ stage: "reporting", message: "Generating report...", progress: 90 });
    const reporter = new QAReporter();
    const duration = Date.now() - startTime;
    const report = await reporter.generate(runId, this.config.targetUrl, scenarios, results, duration);

    this.emit({
      stage: "done",
      message: `QA complete. Score: ${report.score}/100. Pass rate: ${report.passRate.toFixed(1)}%`,
      progress: 100,
      data: report,
    });

    return report;
  }
}
