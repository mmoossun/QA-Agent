/**
 * Standalone evaluation script
 * Usage: npx tsx scripts/evaluate.ts
 */

import { evaluateSystem } from "../lib/evaluation/scorer";
import type { QAScenario, TestResult } from "../lib/ai/types";

const SAMPLE_SCENARIOS: QAScenario[] = [
  {
    id: "AUTH-001",
    name: "Login with valid credentials",
    category: "auth",
    priority: "critical",
    preconditions: ["Login page is accessible"],
    steps: [
      { action: "navigate", value: "/login", description: "Go to login page" },
      { action: "fill", target: { testId: "email-input", css: 'input[type="email"]' }, value: "test@example.com", description: "Enter email" },
      { action: "fill", target: { testId: "password-input", css: 'input[type="password"]' }, value: "password", description: "Enter password" },
      { action: "click", target: { testId: "login-button", css: 'button[type="submit"]' }, description: "Click login" },
      { action: "assert", target: { testId: "dashboard-header" }, description: "Verify dashboard" },
      { action: "screenshot", description: "Capture success state" },
    ],
    expectedResult: "User is redirected to dashboard",
    tags: ["smoke", "auth", "critical-path"],
  },
  {
    id: "AUTH-002",
    name: "Login with wrong password shows error",
    category: "auth",
    priority: "high",
    preconditions: ["Login page is accessible"],
    steps: [
      { action: "navigate", value: "/login", description: "Go to login page" },
      { action: "fill", target: { css: 'input[type="email"]' }, value: "test@example.com", description: "Enter email" },
      { action: "fill", target: { css: 'input[type="password"]' }, value: "wrongpass", description: "Enter wrong password" },
      { action: "click", target: { css: 'button[type="submit"]' }, description: "Click login" },
      { action: "assert", target: { css: '[role="alert"]' }, description: "Check error message" },
    ],
    expectedResult: "Error message shown",
    tags: ["auth", "negative-test"],
  },
];

async function main() {
  console.log("\n=== QA System Evaluation ===\n");

  const score = await evaluateSystem({
    scenarios: SAMPLE_SCENARIOS,
    results: [],
    executionDurationMs: 0,
  });

  console.log(`\nScore Breakdown:`);
  console.log(`  Total:              ${score.total}/100`);
  console.log(`  QA Quality (40%):   ${score.qaQuality}`);
  console.log(`  Exec Reliability (20%): ${score.execReliability}`);
  console.log(`  AI Quality (20%):   ${score.aiQuality}`);
  console.log(`  Code Quality (10%): ${score.codeQuality}`);
  console.log(`  Performance (10%):  ${score.performance}`);
  console.log(`\nIssues (${score.issues.length}):`);
  score.issues.forEach((i) => console.log(`  - ${i}`));
  console.log(`\nImprovements:`);
  score.improvements.forEach((i) => console.log(`  → ${i}`));
  console.log();

  return score;
}

main().catch(console.error);
