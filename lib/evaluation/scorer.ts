/**
 * Scoring System — Evaluates QA system quality across 5 dimensions
 *
 * QA Quality        (40%) — scenario coverage, edge cases, selector strategy
 * Exec Reliability  (20%) — retry logic, timeout handling, flaky detection
 * AI Quality        (20%) — prompt quality, JSON accuracy, scenario relevance
 * Code Quality      (10%) — TypeScript, error handling, modularity
 * Performance       (10%) — speed, parallelism, resource efficiency
 */

import * as fs from "fs";
import * as path from "path";
import type { ScoreBreakdown, TestResult, QAScenario } from "@/lib/ai/types";
import { chat, extractJSON } from "@/lib/ai/claude";
import { EVALUATOR_SYSTEM } from "@/lib/ai/prompts";
import { logger } from "@/lib/logger";

export interface EvaluationInput {
  scenarios: QAScenario[];
  results: TestResult[];
  codeFiles?: string[]; // file paths to evaluate
  executionDurationMs?: number;
}

export async function evaluateSystem(input: EvaluationInput): Promise<ScoreBreakdown> {
  const [qaScore, relScore, aiScore, codeScore, perfScore] = await Promise.all([
    scoreQAQuality(input.scenarios, input.results),
    scoreExecutionReliability(input.results),
    scoreAIQuality(input.scenarios),
    scoreCodeQuality(input.codeFiles ?? []),
    scorePerformance(input.results, input.executionDurationMs ?? 0),
  ]);

  const total = Math.round(
    qaScore.score * 0.4 +
    relScore.score * 0.2 +
    aiScore.score * 0.2 +
    codeScore.score * 0.1 +
    perfScore.score * 0.1
  );

  const allIssues = [
    ...qaScore.issues,
    ...relScore.issues,
    ...aiScore.issues,
    ...codeScore.issues,
    ...perfScore.issues,
  ];

  const allImprovements = [
    ...qaScore.improvements,
    ...relScore.improvements,
    ...aiScore.improvements,
    ...codeScore.improvements,
    ...perfScore.improvements,
  ];

  const breakdown: ScoreBreakdown = {
    total,
    qaQuality: qaScore.score,
    execReliability: relScore.score,
    aiQuality: aiScore.score,
    codeQuality: codeScore.score,
    performance: perfScore.score,
    issues: allIssues,
    improvements: allImprovements,
  };

  logger.info(
    { total, qa: qaScore.score, rel: relScore.score, ai: aiScore.score, code: codeScore.score, perf: perfScore.score },
    "Score breakdown"
  );

  return breakdown;
}

// ─── Individual scorers ───────────────────────────────────────

async function scoreQAQuality(
  scenarios: QAScenario[],
  results: TestResult[]
): Promise<{ score: number; issues: string[]; improvements: string[] }> {
  const issues: string[] = [];
  const improvements: string[] = [];

  if (scenarios.length === 0) {
    return { score: 0, issues: ["No scenarios generated"], improvements: ["Generate QA scenarios"] };
  }

  // Check selector quality
  const hasTestIds = scenarios.some((s) => s.steps.some((step) => step.target?.testId));
  if (!hasTestIds) {
    issues.push("No data-testid selectors used");
    improvements.push("Add data-testid to test selectors for reliability");
  }

  // Check coverage
  const categories = new Set(scenarios.map((s) => s.category));
  const requiredCategories: Array<"auth" | "form" | "ui" | "navigation" | "security" | "api" | "performance"> = ["auth", "form", "ui"];
  for (const cat of requiredCategories) {
    if (!categories.has(cat)) {
      issues.push(`Missing ${cat} test coverage`);
      improvements.push(`Add ${cat} test scenarios`);
    }
  }

  // Check edge cases
  const hasCritical = scenarios.some((s) => s.priority === "critical");
  if (!hasCritical) {
    issues.push("No critical priority scenarios");
    improvements.push("Mark login/payment flows as critical");
  }

  const hasEdgeCases = scenarios.some((s) =>
    s.tags?.includes("negative-test") || s.tags?.includes("edge-case") ||
    s.name.toLowerCase().includes("invalid") || s.name.toLowerCase().includes("error")
  );
  if (!hasEdgeCases) {
    issues.push("No edge case / negative test scenarios");
    improvements.push("Add negative test cases (invalid input, error states)");
  }

  // Check meaningful assertions — scenarios must have assert or waitForUrl steps
  const withMeaningfulAssert = scenarios.filter((s) =>
    s.steps.some((step) => step.action === "assert" || step.action === "waitForUrl")
  );
  const assertCoverage = scenarios.length > 0 ? withMeaningfulAssert.length / scenarios.length : 0;
  if (assertCoverage < 0.6) {
    issues.push(`Only ${Math.round(assertCoverage * 100)}% of scenarios have meaningful assertions`);
    improvements.push("Add assert/waitForUrl steps to verify actual outcomes, not just screenshots");
  }

  // Check waitForUrl usage (especially important for SPA auth flows)
  const hasWaitForUrl = scenarios.some((s) => s.steps.some((step) => step.action === "waitForUrl"));
  if (!hasWaitForUrl && categories.has("auth")) {
    issues.push("Auth scenarios don't verify URL redirect after login");
    improvements.push("Add waitForUrl step after login submit to confirm successful navigation");
  }

  // Check screenshot steps
  const hasScreenshots = scenarios.some((s) => s.steps.some((step) => step.action === "screenshot"));
  if (!hasScreenshots) {
    issues.push("No screenshot steps in scenarios");
    improvements.push("Add screenshot steps at key checkpoints");
  }

  // Score calculation — start at 50 (not 60) so trivial tests can't inflate the score
  let score = 50;
  if (scenarios.length >= 5) score += 5;
  if (scenarios.length >= 10) score += 5;
  if (scenarios.length >= 15) score += 5;
  if (hasTestIds) score += 5;
  if (hasCritical) score += 5;
  if (hasEdgeCases) score += 5;
  if (hasScreenshots) score += 3;
  if (categories.size >= 3) score += 4;
  if (categories.size >= 5) score += 3;
  // Assertion quality bonus — most important
  score += Math.round(assertCoverage * 10); // up to +10 for full assertion coverage
  if (hasWaitForUrl) score += 5;

  if (results.length > 0) {
    const passRate = results.filter((r) => r.status === "pass").length / results.length;
    // Pass rate multiplier: 100% pass = full score, 50% pass = ~75%, 0% = ~50%
    score = Math.round(score * (0.5 + passRate * 0.5));
  }

  return { score: Math.min(100, score), issues, improvements };
}

async function scoreExecutionReliability(
  results: TestResult[]
): Promise<{ score: number; issues: string[]; improvements: string[] }> {
  const issues: string[] = [];
  const improvements: string[] = [];

  if (results.length === 0) {
    return { score: 50, issues: ["No test results to evaluate"], improvements: ["Run QA tests to evaluate reliability"] };
  }

  const retried = results.filter((r) => r.retryCount > 0);
  const selectorErrors = results.filter((r) => r.failureCategory === "selector");
  const timingErrors = results.filter((r) => r.failureCategory === "timing");

  if (selectorErrors.length > 0) {
    issues.push(`${selectorErrors.length} selector failures detected`);
    improvements.push("Improve selector strategy: use testId > ariaLabel > text > css");
  }

  if (timingErrors.length > 0) {
    issues.push(`${timingErrors.length} timing/timeout failures`);
    improvements.push("Add explicit waits and increase timeout for slow elements");
  }

  let score = 70;
  if (retried.length === 0) score += 10; // No retries needed
  if (selectorErrors.length === 0) score += 10;
  if (timingErrors.length === 0) score += 10;

  const passRate = results.filter((r) => r.status === "pass").length / results.length;
  if (passRate >= 0.9) score = Math.min(100, score + 10);
  else if (passRate < 0.5) score = Math.max(0, score - 20);

  return { score: Math.min(100, score), issues, improvements };
}

async function scoreAIQuality(
  scenarios: QAScenario[]
): Promise<{ score: number; issues: string[]; improvements: string[] }> {
  const issues: string[] = [];
  const improvements: string[] = [];

  if (scenarios.length === 0) {
    return { score: 0, issues: ["AI failed to generate scenarios"], improvements: ["Fix Claude API integration"] };
  }

  // Use AI to evaluate scenario quality
  try {
    const sampleScenarios = scenarios.slice(0, 3);
    const response = await chat(
      [{
        role: "user",
        content: `Rate these QA scenarios 0-100 for quality. Consider: clarity, specificity, selector strategy, edge case coverage.\n${JSON.stringify(sampleScenarios, null, 2)}\n\nRespond as JSON: {"score": 75, "issues": ["..."], "improvements": ["..."]}`
      }],
      EVALUATOR_SYSTEM,
      { maxTokens: 500 }
    );

    const parsed = extractJSON<{ score: number; issues: string[]; improvements: string[] }>(response);
    return parsed;
  } catch {
    const hasGoodSteps = scenarios.every((s) => s.steps.length >= 3);
    const hasDescriptions = scenarios.every((s) => s.steps.every((step) => step.description));
    let score = 60;
    if (hasGoodSteps) score += 15;
    if (hasDescriptions) score += 15;
    if (scenarios.length >= 10) score += 10;
    return { score: Math.min(100, score), issues, improvements };
  }
}

async function scoreCodeQuality(
  filePaths: string[]
): Promise<{ score: number; issues: string[]; improvements: string[] }> {
  const issues: string[] = [];
  const improvements: string[] = [];
  let score = 65;

  const codeFiles = [
    "lib/qa/runner.ts",
    "lib/ai/claude.ts",
    "lib/agent/runner/index.ts",
    "lib/evaluation/scorer.ts",
  ];

  const root = process.cwd();
  let totalLines = 0;
  let typedFiles = 0;
  let hasErrorHandling = 0;

  for (const file of codeFiles) {
    const fullPath = path.join(root, file);
    if (!fs.existsSync(fullPath)) continue;

    const content = fs.readFileSync(fullPath, "utf-8");
    totalLines += content.split("\n").length;

    if (content.includes(": ") && content.includes("interface ")) typedFiles++;
    if (content.includes("try {") && content.includes("catch")) hasErrorHandling++;
  }

  if (typedFiles >= 3) score += 10;
  if (hasErrorHandling >= 3) score += 10;
  if (totalLines > 500) score += 5; // Substantial implementation
  if (totalLines > 200 && !issues.length) score += 5;

  const hasLogger = fs.existsSync(path.join(root, "lib/logger.ts"));
  if (!hasLogger) {
    issues.push("No logging system");
    improvements.push("Add structured logging (pino recommended)");
  } else {
    score += 5;
  }

  return { score: Math.min(100, score), issues, improvements };
}

async function scorePerformance(
  results: TestResult[],
  durationMs: number
): Promise<{ score: number; issues: string[]; improvements: string[] }> {
  const issues: string[] = [];
  const improvements: string[] = [];

  if (results.length === 0 || durationMs === 0) {
    return { score: 60, issues: ["No execution data"], improvements: ["Run tests to measure performance"] };
  }

  const avgDuration = durationMs / results.length;
  let score = 70;

  if (avgDuration < 5000) {
    score += 15; // Fast
  } else if (avgDuration > 30_000) {
    score -= 20;
    issues.push(`Slow average scenario time: ${(avgDuration / 1000).toFixed(1)}s`);
    improvements.push("Enable parallel test execution");
  }

  const longTests = results.filter((r) => r.duration > 30_000);
  if (longTests.length > 0) {
    issues.push(`${longTests.length} scenarios took >30s`);
    improvements.push("Set aggressive timeouts and skip non-critical slow tests");
  }

  return { score: Math.min(100, score), issues, improvements };
}
