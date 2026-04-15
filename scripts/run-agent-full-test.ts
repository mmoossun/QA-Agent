/**
 * Full Agent test — scenario sheet hints + custom prompt
 * Usage: npm run test:agent:full
 */

import * as http from "node:http";
import * as path from "path";
import * as dotenv from "dotenv";
dotenv.config({ path: path.resolve(__dirname, "../.env") });

const API_HOST = "localhost";
const API_PORT = 3000;

// ─── 시나리오 시트 (CSV 파싱 결과를 시뮬레이션) ──────────────────
const SCENARIO_HINTS: string[] = [
  "로그인 성공 후 대시보드가 정상적으로 로드되는지 확인 (카테고리:auth) (우선순위:critical)",
  "잘못된 이메일 형식으로 로그인 시도 시 오류 메시지 표시 확인 (카테고리:auth) (우선순위:high)",
  "비밀번호 없이 로그인 버튼 클릭 시 유효성 검사 오류 표시 확인 (카테고리:form) (우선순위:high)",
  "설정 페이지 진입 후 탭 이동이 정상 동작하는지 확인 (카테고리:navigation) (우선순위:medium)",
  "팀 관리 페이지에서 멤버 목록이 표시되는지 확인 (카테고리:ui) (우선순위:medium)",
];

// ─── 사용자 지시사항 (커스텀 프롬프트) ──────────────────────────
const CUSTOM_PROMPT = `
- 한국어 입력값을 우선적으로 사용해줘 (예: 이메일 입력란의 플레이스홀더가 한국어인 경우)
- 설정 페이지 관련 시나리오를 최소 3개 이상 포함해줘
- 각 시나리오마다 스크린샷을 반드시 찍어줘
- 로그인 실패 케이스를 다양하게 테스트해줘 (빈 필드, 잘못된 이메일, 틀린 비밀번호)
`.trim();

interface AgentReport {
  score: number; passed: number; failed: number; errors: number;
  passRate: number; totalScenarios: number; duration: number;
  summary: string; recommendations: string[];
  scenarios: { scenarioId: string; scenarioName: string; status: string; duration: number; errorMessage?: string }[];
  bugReports: { severity: string; title: string; description: string }[];
}

interface AgentEvent {
  type: string;
  stage?: string;
  message?: string;
  progress?: number;
  report?: AgentReport;
}

async function runFullTest() {
  console.log("\n══════════════════════════════════════════════════════");
  console.log("  AGENT FULL TEST — 시나리오 시트 + 사용자 지시사항");
  console.log("══════════════════════════════════════════════════════\n");

  console.log("📋 시나리오 시트 힌트:");
  SCENARIO_HINTS.forEach((h, i) => console.log(`  ${i + 1}. ${h}`));

  console.log("\n💬 사용자 지시사항:");
  CUSTOM_PROMPT.split("\n").forEach((l) => console.log(`  ${l}`));
  console.log("");

  const body = {
    targetUrl: "https://app-dev.generativelab.co.kr",
    loginEmail: "qa-owner@example.com",
    loginPassword: "TestPassword123",
    maxScenarios: 15,
    scenarioCategories: ["auth", "form", "ui", "navigation", "security"],
    customPrompt: CUSTOM_PROMPT,
    scenarioHints: SCENARIO_HINTS,
  };

  const startTime = Date.now();
  let lastProgress = 0;
  let finalReport: AgentReport | null = null;

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
          } catch { /* ignore */ }
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
  console.log(`\n\n${"═".repeat(56)}`);

  if (!finalReport) {
    console.error("리포트를 받지 못했습니다.");
    process.exit(1);
  }

  const r = finalReport;
  const icon = (s: string) => s === "pass" ? "✅" : s === "fail" ? "❌" : "⚠️";

  console.log(`\n  SCORE: ${r.score}/100   Pass Rate: ${r.passRate.toFixed(1)}%   Time: ${elapsed}s`);
  console.log(`  PASS ${r.passed} / FAIL ${r.failed} / ERROR ${r.errors} / TOTAL ${r.totalScenarios}\n`);
  console.log(`  Summary: ${r.summary}\n`);

  console.log("  ── 시나리오 결과 ─────────────────────────────────");
  for (const s of r.scenarios) {
    const dur = `${(s.duration / 1000).toFixed(1)}s`;
    const err = s.errorMessage ? `  → ${s.errorMessage.slice(0, 80)}` : "";
    console.log(`  ${icon(s.status)} [${s.status.toUpperCase().padEnd(5)}] ${s.scenarioName.slice(0, 45).padEnd(46)} ${dur}${err}`);
  }

  if (r.bugReports.length > 0) {
    console.log("\n  ── 버그 리포트 ────────────────────────────────────");
    for (const bug of r.bugReports) {
      console.log(`  🐛 [${bug.severity.toUpperCase()}] ${bug.title}`);
      console.log(`     ${bug.description.slice(0, 100)}`);
    }
  }

  if (r.recommendations.length > 0) {
    console.log("\n  ── 개선 권고 ──────────────────────────────────────");
    for (const rec of r.recommendations) {
      console.log(`  💡 ${rec}`);
    }
  }

  console.log(`\n${"═".repeat(56)}\n`);
}

runFullTest().catch((e) => { console.error(e); process.exit(1); });
