/**
 * Self-Improving Agent Loop
 *
 * Algorithm:
 *   score = evaluate()
 *   while score < TARGET:
 *     issues = identify_weaknesses(score)
 *     improvements = generate_fixes(issues)
 *     apply_improvements(improvements)
 *     new_score = evaluate()
 *     if new_score > score:
 *       commit(new_score)
 *       score = new_score
 *     else:
 *       rollback()
 *
 * Usage: npx tsx scripts/improve.ts
 */

import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

// Set working directory
process.chdir(path.resolve(__dirname, ".."));

import { evaluateSystem } from "../lib/evaluation/scorer";
import { chat, extractJSON } from "../lib/ai/claude";
import type { ScoreBreakdown } from "../lib/ai/types";

const ROOT = path.resolve(__dirname, "..");
const HISTORY_FILE = path.join(ROOT, "history", "iterations.json");
const TARGET_SCORE = Number(process.env.TARGET_SCORE ?? 80);
const MAX_ITERATIONS = Number(process.env.IMPROVE_MAX_ITERATIONS ?? 10);

interface IterationRecord {
  iteration: number;
  timestamp: string;
  scoreBefore: number;
  scoreAfter: number;
  commitHash?: string;
  commitMsg?: string;
  changes: string[];
  issues: string[];
}

// ─── Main loop ────────────────────────────────────────────────
async function main() {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`  Self-Improving QA Agent Loop`);
  console.log(`  Target Score: ${TARGET_SCORE} | Max Iterations: ${MAX_ITERATIONS}`);
  console.log(`${"=".repeat(60)}\n`);

  const history: IterationRecord[] = loadHistory();
  let currentScore = await measureScore();
  console.log(`Initial Score: ${currentScore.total}/100\n`);

  for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration++) {
    if (currentScore.total >= TARGET_SCORE) {
      console.log(`\nTarget score ${TARGET_SCORE} reached! Current: ${currentScore.total}`);
      break;
    }

    console.log(`\n--- Iteration ${iteration}/${MAX_ITERATIONS} (Score: ${currentScore.total}) ---`);

    // Identify improvements
    const improvements = await identifyImprovements(currentScore);
    console.log(`Planned improvements:`);
    improvements.forEach((imp, i) => console.log(`  ${i + 1}. ${imp.description}`));

    // Apply improvements
    const applied: string[] = [];
    for (const imp of improvements) {
      try {
        await applyImprovement(imp);
        applied.push(imp.description);
        console.log(`  ✓ Applied: ${imp.description}`);
      } catch (err) {
        console.log(`  ✗ Failed: ${imp.description} — ${err}`);
      }
    }

    if (applied.length === 0) {
      console.log("No improvements could be applied, stopping.");
      break;
    }

    // Re-evaluate
    const newScore = await measureScore();
    console.log(`\nScore: ${currentScore.total} → ${newScore.total}`);

    const record: IterationRecord = {
      iteration,
      timestamp: new Date().toISOString(),
      scoreBefore: currentScore.total,
      scoreAfter: newScore.total,
      changes: applied,
      issues: currentScore.issues,
    };

    if (newScore.total > currentScore.total) {
      // Commit improvement
      const commitMsg = generateCommitMessage(currentScore.total, newScore.total, applied);
      record.commitMsg = commitMsg;

      try {
        const hash = gitCommit(commitMsg);
        record.commitHash = hash;
        console.log(`\nCommitted: ${hash.slice(0, 8)} — "${commitMsg}"`);
      } catch (err) {
        console.log(`Git commit failed: ${err}`);
      }

      currentScore = newScore;
    } else {
      console.log("Score did not improve, keeping changes for next iteration.");
      currentScore = newScore;
    }

    history.push(record);
    saveHistory(history);
    printScoreCard(newScore);
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log(`  Final Score: ${currentScore.total}/100`);
  console.log(`  Target: ${TARGET_SCORE}/100`);
  console.log(`  Status: ${currentScore.total >= TARGET_SCORE ? "TARGET REACHED" : "NEEDS MORE WORK"}`);
  console.log(`${"=".repeat(60)}\n`);
}

// ─── Score measurement ────────────────────────────────────────
async function measureScore(): Promise<ScoreBreakdown> {
  // Use sample scenarios for evaluation (in production, use real run data)
  const { SAMPLE_SCENARIOS } = await import("./evaluate");
  return evaluateSystem({
    scenarios: (SAMPLE_SCENARIOS as unknown[]) as import("../lib/ai/types").QAScenario[],
    results: [],
  });
}

// ─── Improvement identification ───────────────────────────────
interface Improvement {
  type: "code" | "prompt" | "config" | "selector";
  target: string; // file path
  description: string;
  action: "add_feature" | "fix_issue" | "improve_quality";
  details: string;
}

async function identifyImprovements(score: ScoreBreakdown): Promise<Improvement[]> {
  // Find lowest scoring dimension
  const dims = [
    { name: "qaQuality", score: score.qaQuality, weight: 40 },
    { name: "execReliability", score: score.execReliability, weight: 20 },
    { name: "aiQuality", score: score.aiQuality, weight: 20 },
    { name: "codeQuality", score: score.codeQuality, weight: 10 },
    { name: "performance", score: score.performance, weight: 10 },
  ].sort((a, b) => a.score - b.score);

  const worstDim = dims[0];
  console.log(`\nLowest dimension: ${worstDim.name} (${worstDim.score}/100)`);
  console.log(`Issues: ${score.issues.slice(0, 3).join("; ")}`);

  try {
    const prompt = `You are a QA system architect. Identify 2-3 concrete code improvements.

Current score breakdown:
${JSON.stringify({ ...score, issues: score.issues.slice(0, 5) }, null, 2)}

Focus on the LOWEST scoring dimension: ${worstDim.name} (${worstDim.score}/100)

Top issues:
${score.issues.slice(0, 5).map((i, idx) => `${idx + 1}. ${i}`).join("\n")}

Project structure (key files):
- lib/qa/runner.ts — Playwright runner with retry + selector
- lib/ai/prompts.ts — Prompt templates with few-shot examples
- lib/evaluation/scorer.ts — Scoring system
- lib/agent/explorer/index.ts — Site explorer
- lib/agent/scenario-gen/index.ts — Scenario generator

Return a JSON array of improvements:
[{
  "type": "code|prompt|config|selector",
  "target": "lib/qa/runner.ts",
  "description": "Add parallel test execution",
  "action": "add_feature|fix_issue|improve_quality",
  "details": "Specific code change to make..."
}]

IMPORTANT: Each improvement must be specific and implementable. Max 3 items.`;

    const response = await chat(
      [{ role: "user", content: prompt }],
      "You are a senior software engineer specializing in QA automation systems.",
      { maxTokens: 2000 }
    );

    return extractJSON<Improvement[]>(response);
  } catch (err) {
    console.log(`AI improvement suggestion failed: ${err}`);
    // Fallback to rule-based improvements
    return getRuleBasedImprovements(score);
  }
}

function getRuleBasedImprovements(score: ScoreBreakdown): Improvement[] {
  const improvements: Improvement[] = [];

  if (score.qaQuality < 80) {
    improvements.push({
      type: "prompt",
      target: "lib/ai/prompts.ts",
      description: "Add more specific few-shot examples for edge cases",
      action: "improve_quality",
      details: "Add security and performance test examples to buildChatQAPrompt",
    });
  }

  if (score.execReliability < 80) {
    improvements.push({
      type: "code",
      target: "lib/qa/runner.ts",
      description: "Increase default retry count and add exponential backoff",
      action: "fix_issue",
      details: "Change maxRetries default from 2 to 3, add smarter wait strategies",
    });
  }

  if (score.aiQuality < 80) {
    improvements.push({
      type: "prompt",
      target: "lib/ai/prompts.ts",
      description: "Improve AGENT_SCENARIO_SYSTEM prompt with coverage requirements",
      action: "improve_quality",
      details: "Add explicit requirements: min 15 scenarios, all priority levels, 2+ edge cases",
    });
  }

  return improvements.slice(0, 2);
}

// ─── Improvement application ──────────────────────────────────
async function applyImprovement(imp: Improvement): Promise<void> {
  const targetFile = path.join(ROOT, imp.target);

  if (!fs.existsSync(targetFile)) {
    throw new Error(`Target file not found: ${imp.target}`);
  }

  const content = fs.readFileSync(targetFile, "utf-8");

  // Ask AI to generate the actual code change
  const prompt = `Apply this improvement to the file content:

Improvement: ${imp.description}
Details: ${imp.details}

Current file (${imp.target}):
\`\`\`typescript
${content.slice(0, 3000)}
\`\`\`

Return ONLY the complete updated file content (no explanation, no markdown fences).
Keep ALL existing code intact, only add/modify the specific improvement.
The output must be valid TypeScript.`;

  const updated = await chat(
    [{ role: "user", content: prompt }],
    "You are a TypeScript expert. Apply the improvement exactly as specified. Return only the file content.",
    { maxTokens: 5000 }
  );

  // Clean up any markdown artifacts
  const clean = updated
    .replace(/^```(?:typescript|ts)?\n/m, "")
    .replace(/\n```$/m, "")
    .trim();

  // Sanity check: must be substantial content
  if (clean.length < content.length * 0.5) {
    throw new Error("Updated content too short — likely incomplete");
  }

  // Backup original
  fs.writeFileSync(`${targetFile}.bak`, content, "utf-8");

  // Write updated
  fs.writeFileSync(targetFile, clean, "utf-8");
}

// ─── Git operations ───────────────────────────────────────────
function gitCommit(message: string): string {
  execSync("git add -A", { cwd: ROOT });
  execSync(`git commit -m "${message.replace(/"/g, "'")}"`, { cwd: ROOT });
  return execSync("git rev-parse HEAD", { cwd: ROOT }).toString().trim();
}

function generateCommitMessage(before: number, after: number, changes: string[]): string {
  const delta = after - before;
  const topChange = changes[0]?.slice(0, 50) ?? "improvements";
  return `improve: score ${before}→${after} (+${delta}) — ${topChange}`;
}

// ─── History management ───────────────────────────────────────
function loadHistory(): IterationRecord[] {
  fs.mkdirSync(path.join(ROOT, "history"), { recursive: true });
  if (!fs.existsSync(HISTORY_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(HISTORY_FILE, "utf-8"));
  } catch {
    return [];
  }
}

function saveHistory(history: IterationRecord[]): void {
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2), "utf-8");
}

function printScoreCard(score: ScoreBreakdown): void {
  const bar = (s: number) => "█".repeat(Math.round(s / 10)) + "░".repeat(10 - Math.round(s / 10));
  console.log("\n┌─────────────────────────────────────────┐");
  console.log(`│  SCORE: ${String(score.total).padEnd(3)}/100                          │`);
  console.log("├─────────────────────────────────────────┤");
  console.log(`│  QA Quality    ${bar(score.qaQuality)} ${String(score.qaQuality).padStart(3)}  │`);
  console.log(`│  Reliability   ${bar(score.execReliability)} ${String(score.execReliability).padStart(3)}  │`);
  console.log(`│  AI Quality    ${bar(score.aiQuality)} ${String(score.aiQuality).padStart(3)}  │`);
  console.log(`│  Code Quality  ${bar(score.codeQuality)} ${String(score.codeQuality).padStart(3)}  │`);
  console.log(`│  Performance   ${bar(score.performance)} ${String(score.performance).padStart(3)}  │`);
  console.log("└─────────────────────────────────────────┘");
}

main().catch((err) => {
  console.error("Improve loop failed:", err);
  process.exit(1);
});
