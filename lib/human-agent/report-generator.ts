/**
 * GPT-4o report generator — turns a completed HumanAgentResult into a
 * structured QA report with root-cause analysis, findings, and recommendations.
 */

import { openAIClient } from "@/lib/ai/openai";
import { extractJSON } from "@/lib/ai/claude";
import type { HumanAgentResult, HumanStep } from "@/lib/human-agent/runner";

// ─── Report Types (exported for UI) ──────────────────────────

export type RiskLevel = "low" | "medium" | "high" | "critical";
export type FindingType = "bug" | "warning" | "info";
export type FindingSeverity = "critical" | "high" | "medium" | "low";

export interface TestFinding {
  type: FindingType;
  severity: FindingSeverity;
  title: string;
  description: string;
  rootCause: string;
  reproductionSteps: string;
  recommendation: string;
  stepNumber: number;
  screenshotPath?: string;
}

export interface TestReport {
  id: string;
  createdAt: string;
  targetUrl: string;
  goal: string;
  status: "done" | "fail" | "max_steps";
  riskLevel: RiskLevel;
  executiveSummary: string;
  testedFeatures: string[];
  findings: TestFinding[];
  recommendations: string[];
  passRate: number;
  totalDurationMs: number;
  stepCount: number;
  steps: HumanStep[];
}

// ─── Generator ────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a senior QA engineer writing a structured test report.
Analyze the provided test run data and return ONLY raw JSON (no markdown, no code fences).`;

function buildStepSummary(steps: HumanStep[]): string {
  return steps.map(s =>
    `Step ${s.stepNumber} [${s.decision.action}${s.decision.target ? " " + s.decision.target : ""}]: ${s.decision.description}` +
    (s.success ? " ✓" : ` ✗ ERROR: ${s.error ?? "unknown"}`) +
    ` (${(s.durationMs / 1000).toFixed(1)}s)`
  ).join("\n");
}

function buildUserPrompt(result: HumanAgentResult): string {
  const passCount = result.steps.filter(s => s.success).length;
  const passRate = result.steps.length > 0
    ? ((passCount / result.steps.length) * 100).toFixed(1)
    : "0";

  const failedSteps = result.steps.filter(s => !s.success);

  return `## Test Run Data

URL: ${result.targetUrl}
Goal: ${result.goal || "(자유 탐색)"}
Status: ${result.status}
Pass rate: ${passRate}% (${passCount}/${result.steps.length} steps)
Duration: ${(result.totalDurationMs / 1000).toFixed(1)}s
Agent summary: ${result.summary}

## Step History
${buildStepSummary(result.steps)}

${failedSteps.length > 0 ? `## Failed Steps (${failedSteps.length})
${failedSteps.map(s =>
  `Step ${s.stepNumber} [${s.decision.action}]: ${s.decision.description}\n  Error: ${s.error}\n  Page state: ${s.decision.observation}`
).join("\n\n")}` : "## All Steps Passed"}

## Required JSON Output
{
  "riskLevel": "low|medium|high|critical",
  "executiveSummary": "2-3 sentence professional summary of what was tested and key findings (Korean OK)",
  "testedFeatures": ["feature 1", "feature 2", ...],
  "findings": [
    {
      "type": "bug|warning|info",
      "severity": "critical|high|medium|low",
      "title": "short title (Korean OK)",
      "description": "what happened",
      "rootCause": "why it happened (technical root cause)",
      "reproductionSteps": "numbered steps to reproduce",
      "recommendation": "how to fix",
      "stepNumber": <step number where this was detected>
    }
  ],
  "recommendations": ["recommendation 1", "recommendation 2", ...]
}

Rules:
- findings: ONLY include real bugs/warnings observed. If all steps passed, findings can be empty or have info-level items.
- riskLevel: critical=data loss/security, high=core feature broken, medium=degraded UX, low=minor issue
- Keep Korean for user-facing text, English for technical terms
- Be precise about root causes (e.g. "element locator changed", "API 500 error", "race condition")`;
}

export async function generateReport(result: HumanAgentResult): Promise<TestReport> {
  const client = openAIClient();

  const passCount = result.steps.filter(s => s.success).length;
  const passRate = result.steps.length > 0
    ? (passCount / result.steps.length) * 100
    : 0;

  let aiOutput: {
    riskLevel: RiskLevel;
    executiveSummary: string;
    testedFeatures: string[];
    findings: Omit<TestFinding, "screenshotPath">[];
    recommendations: string[];
  };

  try {
    const response = await client.chat.completions.create({
      model: "gpt-4o",
      max_tokens: 2048,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserPrompt(result) },
      ],
    });

    const raw = response.choices[0]?.message?.content ?? "{}";
    aiOutput = extractJSON(raw) as typeof aiOutput;
  } catch {
    // Fallback: basic report if AI call fails
    aiOutput = {
      riskLevel: result.status === "done" ? "low" : "high",
      executiveSummary: result.summary,
      testedFeatures: [],
      findings: result.steps
        .filter(s => !s.success)
        .map(s => ({
          type: "bug" as FindingType,
          severity: "medium" as FindingSeverity,
          title: `Step ${s.stepNumber} 실패: ${s.decision.action}`,
          description: s.decision.description,
          rootCause: s.error ?? "알 수 없음",
          reproductionSteps: `1. ${s.decision.description}`,
          recommendation: "수동 확인 필요",
          stepNumber: s.stepNumber,
        })),
      recommendations: [],
    };
  }

  // Attach screenshot paths to findings
  const findings: TestFinding[] = (aiOutput.findings ?? []).map(f => ({
    ...f,
    screenshotPath: result.steps.find(s => s.stepNumber === f.stepNumber)?.screenshotPath,
  }));

  return {
    id: result.sessionId,
    createdAt: new Date().toISOString(),
    targetUrl: result.targetUrl,
    goal: result.goal,
    status: result.status,
    riskLevel: aiOutput.riskLevel ?? "medium",
    executiveSummary: aiOutput.executiveSummary ?? result.summary,
    testedFeatures: aiOutput.testedFeatures ?? [],
    findings,
    recommendations: aiOutput.recommendations ?? [],
    passRate,
    totalDurationMs: result.totalDurationMs,
    stepCount: result.steps.length,
    steps: result.steps,
  };
}
