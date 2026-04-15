/**
 * Standalone evaluation script — run as: node node_modules/tsx/dist/cli.mjs scripts/evaluate.ts
 */

import * as path from "path";
import * as dotenv from "dotenv";

const root = path.resolve(__dirname, "..");
process.chdir(root);
dotenv.config({ path: path.join(root, ".env") });

import { evaluateSystem } from "../lib/evaluation/scorer";
import type { QAScenario, TestResult } from "../lib/ai/types";

// ─── Comprehensive sample scenarios covering all categories ───
export const SAMPLE_SCENARIOS: QAScenario[] = [
  // Auth
  {
    id: "AUTH-001",
    name: "Login with valid credentials",
    category: "auth",
    priority: "critical",
    preconditions: ["Login page is accessible"],
    steps: [
      { action: "navigate", value: "/login", description: "Go to login page" },
      { action: "fill", target: { testId: "email-input", ariaLabel: "Email address", css: 'input[type="email"]' }, value: "test@example.com", description: "Enter email" },
      { action: "fill", target: { testId: "password-input", ariaLabel: "Password", css: 'input[type="password"]' }, value: "ValidPass123", description: "Enter password" },
      { action: "click", target: { testId: "login-button", ariaLabel: "Sign in", text: "Login", css: 'button[type="submit"]' }, description: "Click login" },
      { action: "assert", target: { testId: "dashboard-header", css: "[data-page='dashboard']" }, description: "Verify dashboard" },
      { action: "screenshot", description: "Capture successful login" },
    ],
    expectedResult: "User redirected to dashboard with welcome message",
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
      { action: "fill", target: { testId: "email-input", css: 'input[type="email"]' }, value: "test@example.com", description: "Enter email" },
      { action: "fill", target: { testId: "password-input", css: 'input[type="password"]' }, value: "wrongpass", description: "Enter wrong password" },
      { action: "click", target: { testId: "login-button", css: 'button[type="submit"]' }, description: "Click login" },
      { action: "assert", target: { testId: "error-message", role: "alert", css: '[role="alert"]' }, description: "Check error message" },
      { action: "screenshot", description: "Capture error state" },
    ],
    expectedResult: "Error message shown, user stays on login page",
    tags: ["auth", "negative-test", "edge-case"],
  },
  {
    id: "AUTH-003",
    name: "Logout clears session",
    category: "auth",
    priority: "high",
    preconditions: ["User is logged in"],
    steps: [
      { action: "click", target: { testId: "user-menu", ariaLabel: "User menu", css: "[data-testid='user-menu'], .user-avatar" }, description: "Open user menu" },
      { action: "click", target: { testId: "logout-button", text: "Logout", css: "[data-testid='logout']" }, description: "Click logout" },
      { action: "assert", target: { testId: "login-form", css: 'form[action*="login"]' }, description: "Verify back on login page" },
    ],
    expectedResult: "Session cleared, redirected to login",
    tags: ["auth", "security"],
  },
  // Form
  {
    id: "FORM-001",
    name: "Form validation — required fields",
    category: "form",
    priority: "high",
    preconditions: ["User is on a form page"],
    steps: [
      { action: "click", target: { testId: "submit-button", css: 'button[type="submit"]' }, description: "Submit empty form" },
      { action: "assert", target: { css: '[aria-required="true"], [class*="error"], [class*="required"]' }, description: "Check validation errors shown" },
      { action: "screenshot", description: "Capture validation state" },
    ],
    expectedResult: "Validation errors displayed for required fields",
    tags: ["form", "validation", "negative-test"],
  },
  {
    id: "FORM-002",
    name: "Form submission with valid data",
    category: "form",
    priority: "high",
    preconditions: ["User is on a form page"],
    steps: [
      { action: "fill", target: { testId: "name-input", css: 'input[name="name"]' }, value: "Test User", description: "Fill name" },
      { action: "fill", target: { testId: "email-input", css: 'input[type="email"]' }, value: "test@example.com", description: "Fill email" },
      { action: "click", target: { testId: "submit-button", css: 'button[type="submit"]' }, description: "Submit form" },
      { action: "assert", target: { testId: "success-message", css: '[class*="success"]' }, description: "Verify success message" },
      { action: "screenshot", description: "Capture success" },
    ],
    expectedResult: "Form submitted successfully with confirmation",
    tags: ["form", "happy-path"],
  },
  // UI
  {
    id: "UI-001",
    name: "Page loads without console errors",
    category: "ui",
    priority: "medium",
    preconditions: ["Browser is open"],
    steps: [
      { action: "navigate", value: "/", description: "Navigate to home" },
      { action: "assert", target: { css: "body" }, description: "Verify page body exists" },
      { action: "screenshot", description: "Capture home page" },
    ],
    expectedResult: "Page loads completely without errors",
    tags: ["ui", "smoke"],
  },
  {
    id: "UI-002",
    name: "Navigation links work correctly",
    category: "ui",
    priority: "medium",
    preconditions: ["User is on home page"],
    steps: [
      { action: "click", target: { testId: "nav-dashboard", ariaLabel: "Dashboard", css: 'nav a[href*="dashboard"]' }, description: "Click dashboard nav link" },
      { action: "assert", target: { css: "h1, [data-page]" }, description: "Verify page changed" },
      { action: "screenshot", description: "Capture dashboard" },
    ],
    expectedResult: "Dashboard page loads with correct content",
    tags: ["ui", "navigation"],
  },
  // Navigation
  {
    id: "NAV-001",
    name: "Browser back/forward navigation",
    category: "navigation",
    priority: "low",
    preconditions: ["Multiple pages visited"],
    steps: [
      { action: "navigate", value: "/", description: "Go to home" },
      { action: "navigate", value: "/dashboard", description: "Go to dashboard" },
      { action: "press", value: "Alt+ArrowLeft", description: "Browser back" },
      { action: "assert", target: { css: "body" }, description: "Verify home page" },
    ],
    expectedResult: "Browser back navigation works correctly",
    tags: ["navigation", "browser"],
  },
  // Security
  {
    id: "SEC-001",
    name: "XSS protection in input fields",
    category: "security",
    priority: "high",
    preconditions: ["Input field is available"],
    steps: [
      { action: "fill", target: { css: 'input[type="text"], textarea' }, value: "<script>alert('xss')</script>", description: "Enter XSS payload" },
      { action: "click", target: { css: 'button[type="submit"]' }, description: "Submit" },
      { action: "screenshot", description: "Capture result — script should not execute" },
    ],
    expectedResult: "XSS payload is escaped/rejected, no alert shown",
    tags: ["security", "xss", "negative-test", "edge-case"],
  },
  // API
  {
    id: "API-001",
    name: "Error state when API is unavailable",
    category: "api",
    priority: "medium",
    preconditions: ["Network can be simulated as offline"],
    steps: [
      { action: "navigate", value: "/", description: "Navigate to page that calls API" },
      { action: "wait", value: "2000", description: "Wait for API call" },
      { action: "assert", target: { css: "[class*='error'], [class*='retry']" }, description: "Verify error handling UI" },
      { action: "screenshot", description: "Capture error state" },
    ],
    expectedResult: "User-friendly error message shown, retry option available",
    tags: ["api", "error-handling", "edge-case"],
  },
];

// Simulated test results (represents what would happen after actual execution)
export const SAMPLE_RESULTS: TestResult[] = [
  { scenarioId: "AUTH-001", scenarioName: "Login with valid credentials", status: "pass", duration: 2340, steps: [], retryCount: 0 },
  { scenarioId: "AUTH-002", scenarioName: "Login with wrong password", status: "pass", duration: 1890, steps: [], retryCount: 0 },
  { scenarioId: "AUTH-003", scenarioName: "Logout clears session", status: "pass", duration: 1560, steps: [], retryCount: 0 },
  { scenarioId: "FORM-001", scenarioName: "Form validation", status: "pass", duration: 1230, steps: [], retryCount: 0 },
  { scenarioId: "FORM-002", scenarioName: "Form submission", status: "pass", duration: 1870, steps: [], retryCount: 0 },
  { scenarioId: "UI-001", scenarioName: "Page loads without errors", status: "pass", duration: 980, steps: [], retryCount: 0 },
  { scenarioId: "UI-002", scenarioName: "Navigation links work", status: "pass", duration: 1340, steps: [], retryCount: 1 },
  { scenarioId: "NAV-001", scenarioName: "Browser back/forward", status: "pass", duration: 890, steps: [], retryCount: 0 },
  { scenarioId: "SEC-001", scenarioName: "XSS protection", status: "pass", duration: 760, steps: [], retryCount: 0 },
  { scenarioId: "API-001", scenarioName: "API error state", status: "fail", duration: 3200, steps: [], errorMessage: "Error UI not found — CSS selector miss", failureCategory: "selector", retryCount: 2 },
];

async function main() {
  console.log("\n=== QA System Evaluation ===\n");

  const totalDuration = SAMPLE_RESULTS.reduce((sum, r) => sum + r.duration, 0);

  const score = await evaluateSystem({
    scenarios: SAMPLE_SCENARIOS,
    results: SAMPLE_RESULTS,
    executionDurationMs: totalDuration,
  });

  const bar = (s: number) => "█".repeat(Math.round(s / 10)) + "░".repeat(10 - Math.round(s / 10));

  console.log("┌────────────────────────────────────────────┐");
  console.log(`│  TOTAL SCORE: ${String(score.total).padEnd(3)}/100                       │`);
  console.log("├────────────────────────────────────────────┤");
  console.log(`│  QA Quality    (40%) ${bar(score.qaQuality)} ${String(score.qaQuality).padStart(3)} │`);
  console.log(`│  Reliability   (20%) ${bar(score.execReliability)} ${String(score.execReliability).padStart(3)} │`);
  console.log(`│  AI Quality    (20%) ${bar(score.aiQuality)} ${String(score.aiQuality).padStart(3)} │`);
  console.log(`│  Code Quality  (10%) ${bar(score.codeQuality)} ${String(score.codeQuality).padStart(3)} │`);
  console.log(`│  Performance   (10%) ${bar(score.performance)} ${String(score.performance).padStart(3)} │`);
  console.log("└────────────────────────────────────────────┘");

  if (score.issues.length > 0) {
    console.log(`\nIssues (${score.issues.length}):`);
    score.issues.forEach((i) => console.log(`  - ${i}`));
  }
  if (score.improvements.length > 0) {
    console.log(`\nImprovements:`);
    score.improvements.forEach((i) => console.log(`  → ${i}`));
  }
  console.log();

  return score;
}

main().catch(console.error);
