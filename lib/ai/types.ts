// ─── Shared AI / QA Types ─────────────────────────────────────

export interface QAScenario {
  id: string;
  name: string;
  category: "auth" | "navigation" | "form" | "api" | "ui" | "security" | "performance";
  priority: "critical" | "high" | "medium" | "low";
  preconditions: string[];
  steps: QAStep[];
  expectedResult: string;
  tags: string[];
}

export interface QAStep {
  action: "navigate" | "click" | "fill" | "assert" | "wait" | "screenshot" | "scroll" | "hover" | "press";
  target?: SelectorStrategy;
  value?: string;
  description: string;
  timeout?: number;
}

export interface SelectorStrategy {
  testId?: string;        // data-testid (highest priority)
  ariaLabel?: string;     // aria-label
  text?: string;          // visible text
  css?: string;           // CSS selector
  xpath?: string;         // XPath (fallback)
  role?: string;          // ARIA role
}

export interface TestResult {
  scenarioId: string;
  scenarioName: string;
  status: "pass" | "fail" | "error" | "skip";
  duration: number;
  steps: StepResult[];
  screenshotPath?: string;
  errorMessage?: string;
  failureCategory?: "selector" | "timing" | "assertion" | "network" | "real_bug";
  retryCount: number;
}

export interface StepResult {
  step: QAStep;
  status: "pass" | "fail" | "skip";
  duration: number;
  error?: string;
  screenshotPath?: string;
}

export interface SiteStructure {
  url: string;
  title: string;
  routes: RouteInfo[];
  forms: FormInfo[];
  authRequired: boolean;
  spa: boolean;
  technologies: string[];
}

export interface RouteInfo {
  path: string;
  title: string;
  hasAuth: boolean;
  priority: number;
  elements: string[];
}

export interface FormInfo {
  selector: string;
  fields: string[];
  submitSelector: string;
  purpose: string;
}

export interface QAReport {
  runId: string;
  targetUrl: string;
  timestamp: string;
  duration: number;
  totalScenarios: number;
  passed: number;
  failed: number;
  errors: number;
  skipped: number;
  passRate: number;
  score: number;
  scenarios: TestResult[];
  bugReports: BugInfo[];
  summary: string;
  recommendations: string[];
}

export interface BugInfo {
  title: string;
  severity: "critical" | "high" | "medium" | "low";
  category: "selector" | "timing" | "logic" | "ui" | "security";
  description: string;
  steps: string[];
  expected: string;
  actual: string;
  screenshotUrl?: string;
}

export interface ScoreBreakdown {
  total: number;
  qaQuality: number;       // 40%
  execReliability: number; // 20%
  aiQuality: number;       // 20%
  codeQuality: number;     // 10%
  performance: number;     // 10%
  issues: string[];
  improvements: string[];
}
