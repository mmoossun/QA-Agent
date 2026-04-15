/**
 * Agent end-to-end test — calls live API and prints full report
 * Usage: npx tsx scripts/run-agent-test.ts
 *
 * Uses node:http instead of fetch to avoid body timeout on long SSE streams.
 */

import * as http from "node:http";
import * as path from "path";
import * as dotenv from "dotenv";
dotenv.config({ path: path.resolve(__dirname, "../.env") });

const API_HOST = "localhost";
const API_PORT = 3000;

interface AgentReport {
  score: number; passed: number; failed: number; errors: number;
  passRate: number; totalScenarios: number; duration: number;
  summary: string; recommendations: string[];
  scenarios: { scenarioId: string; scenarioName: string; status: string; duration: number; errorMessage?: string; failureCategory?: string }[];
  bugReports: { severity: string; title: string; description: string; category: string }[];
}

interface AgentEvent {
  type: string;
  stage?: string;
  message?: string;
  progress?: number;
  report?: AgentReport;
}

async function runAgentTest() {
  console.log("\n══════════════════════════════════════════════");
  console.log("  AUTO AGENT TEST — Target: 90/100");
  console.log("══════════════════════════════════════════════\n");

  const body = {
    targetUrl: "https://app-dev.generativelab.co.kr",
    loginEmail: "qa-owner@example.com",
    loginPassword: "TestPassword123",
    maxScenarios: 15,
    scenarioCategories: ["auth", "form", "ui", "navigation", "security", "api", "performance"],
  };

  console.log(`Target:     ${body.targetUrl}`);
  console.log(`Account:    ${body.loginEmail}`);
  console.log(`Scenarios:  max ${body.maxScenarios}`);
  console.log(`Categories: ${body.scenarioCategories.join(", ")}`);
  console.log("");

  const startTime = Date.now();
  let lastProgress = 0;
  let finalReport: AgentReport | null = null;

  // Stream processing via http.request — no body timeout
  await new Promise<void>((resolve, reject) => {
    const bodyStr = JSON.stringify(body);

    const req = http.request({
      hostname: API_HOST,
      port: API_PORT,
      path: "/api/agent/run",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(bodyStr),
      },
    }, (res) => {
      let buf = "";

      res.on("data", (chunk: Buffer) => {
        buf += chunk.toString("utf8");
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const event: AgentEvent = JSON.parse(line.slice(6));

            if (event.progress !== undefined && event.progress !== lastProgress) {
              const pct = Math.min(100, Math.max(0, event.progress));
              const filled = Math.floor(pct / 5);
              const bar = "█".repeat(filled) + "░".repeat(20 - filled);
              process.stdout.write(`\r[${bar}] ${pct}%  ${event.stage ?? event.type} — ${event.message ?? ""}`.padEnd(80));
              lastProgress = event.progress;
            } else if (event.message && event.type !== "progress") {
              console.log(`\n[${event.stage ?? event.type}] ${event.message}`);
            }

            if (event.type === "complete" && event.report) {
              finalReport = event.report;
            }
            if (event.type === "error") {
              console.error(`\n\n❌ ERROR: ${event.message}`);
            }
          } catch { /* ignore malformed lines */ }
        }
      });

      res.on("end", resolve);
      res.on("error", reject);
    });

    req.on("error", reject);
    req.write(bodyStr);
    req.end();
  });

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n\n${"═".repeat(50)}`);

  if (!finalReport) {
    console.error("No report received.");
    process.exit(1);
  }

  const r = finalReport;
  const passIcon = (s: string) => s === "pass" ? "✅" : s === "fail" ? "❌" : "⚠️";

  console.log(`\n  SCORE: ${r.score}/100   Pass Rate: ${r.passRate.toFixed(1)}%   Time: ${elapsed}s`);
  console.log(`  PASS ${r.passed} / FAIL ${r.failed} / ERROR ${r.errors} / TOTAL ${r.totalScenarios}\n`);
  console.log(`  Summary: ${r.summary}\n`);

  console.log("  ── Scenario Results ──────────────────────");
  for (const s of r.scenarios) {
    const dur = `${(s.duration / 1000).toFixed(1)}s`;
    const err = s.errorMessage ? `  → ${s.errorMessage.slice(0, 80)}` : "";
    console.log(`  ${passIcon(s.status)} [${s.status.toUpperCase().padEnd(5)}] ${s.scenarioName.slice(0, 45).padEnd(46)} ${dur}${err}`);
  }

  if (r.bugReports.length > 0) {
    console.log("\n  ── Bugs Found ────────────────────────────");
    for (const bug of r.bugReports) {
      console.log(`  🐛 [${bug.severity.toUpperCase()}] ${bug.title}`);
      console.log(`     ${bug.description.slice(0, 100)}`);
    }
  }

  if (r.recommendations.length > 0) {
    console.log("\n  ── Recommendations ───────────────────────");
    for (const rec of r.recommendations) {
      console.log(`  💡 ${rec}`);
    }
  }

  console.log(`\n${"═".repeat(50)}\n`);

  const targetScore = 90;
  if (r.score >= targetScore) {
    console.log(`  🎉 TARGET ACHIEVED: ${r.score} ≥ ${targetScore}`);
  } else {
    console.log(`  ⚠️  Target not reached: ${r.score} < ${targetScore} (gap: ${targetScore - r.score} points)`);
  }
  console.log("");

  process.exit(r.score >= targetScore ? 0 : 1);
}

runAgentTest().catch((e) => { console.error(e); process.exit(1); });
