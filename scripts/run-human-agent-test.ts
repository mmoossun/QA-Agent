/**
 * Human Agent end-to-end test — calls live SSE API and prints step-by-step results
 * Usage: npx tsx scripts/run-human-agent-test.ts [url] [goal]
 *
 * Scores each step:
 *  +5 pts  — step succeeded
 *  +3 pts  — step succeeded with validation
 *  -2 pts  — step failed
 *  +10 pts — final status "done"
 *  +5 pts  — final status "max_steps" (ran through without crash)
 *  -10 pts — final status "fail" or error
 *
 * Max: 100 pts (20 steps × 5 + done bonus)
 */

import * as http from "node:http";
import * as path from "path";
import * as dotenv from "dotenv";
dotenv.config({ path: path.resolve(__dirname, "../.env") });

const API_HOST = "localhost";
const API_PORT = 3000;
const TARGET_SCORE = 95;

// ── Config — edit to change test target ───────────────────────
const TEST_CONFIG = {
  targetUrl:     process.argv[2] ?? "https://app-dev.generativelab.co.kr",
  goal:          process.argv[3] ?? "로그인 후 채팅 목록을 확인하고 첫 번째 채팅방에 입장해 메시지를 확인해줘",
  loginEmail:    "qa-owner@example.com",
  loginPassword: "TestPassword123",
  maxSteps:      20,
  categories:    ["기능 테스트", "UI/UX", "엣지 케이스"],
};

interface HumanStep {
  stepNumber: number;
  perception: string;
  decision: {
    action: string;
    target?: string;
    value?: string;
    description: string;
    observation: string;
  };
  screenshotPath: string;
  success: boolean;
  error?: string;
  durationMs: number;
  perceptionMs: number;
  planningMs: number;
}

interface HumanResult {
  sessionId: string;
  goal: string;
  targetUrl: string;
  steps: HumanStep[];
  status: "done" | "fail" | "max_steps";
  summary: string;
  totalDurationMs: number;
}

// ── Scoring ────────────────────────────────────────────────────
function scoreRun(result: HumanResult): {
  score: number;
  breakdown: string[];
  passRate: number;
} {
  let score = 0;
  const breakdown: string[] = [];
  const steps = result.steps;

  let passed = 0;
  let failed = 0;
  let consecutiveFails = 0;
  let maxConsecutiveFails = 0;

  for (const step of steps) {
    if (step.success) {
      score += 5;
      passed++;
      consecutiveFails = 0;
    } else {
      score -= 2;
      failed++;
      consecutiveFails++;
      maxConsecutiveFails = Math.max(maxConsecutiveFails, consecutiveFails);
    }
  }

  // Status bonus/penalty
  if (result.status === "done") {
    score += 15;
    breakdown.push(`✅ 목표 완료 보너스: +15`);
  } else if (result.status === "max_steps") {
    score += 5;
    breakdown.push(`⏱ 최대 스텝 도달: +5`);
  } else {
    score -= 10;
    breakdown.push(`❌ 실패 종료 패널티: -10`);
  }

  // Reliability bonus: no consecutive failures
  if (maxConsecutiveFails === 0) {
    score += 5;
    breakdown.push(`🎯 무결 실행 보너스: +5`);
  } else if (maxConsecutiveFails <= 1) {
    score += 2;
    breakdown.push(`🎯 안정 실행 보너스: +2`);
  }

  // Speed bonus: avg step time < 20s
  const avgStepMs = steps.reduce((s, st) => s + st.durationMs, 0) / (steps.length || 1);
  if (avgStepMs < 15_000) {
    score += 5;
    breakdown.push(`⚡ 속도 보너스 (avg ${(avgStepMs/1000).toFixed(1)}s): +5`);
  } else if (avgStepMs < 25_000) {
    score += 2;
    breakdown.push(`⚡ 속도 보너스 (avg ${(avgStepMs/1000).toFixed(1)}s): +2`);
  }

  // Normalize to 0-100
  const maxRaw = steps.length * 5 + 15 + 5 + 5;
  const normalized = Math.round(Math.max(0, Math.min(100, (score / maxRaw) * 100)));

  breakdown.unshift(`📊 원점수: ${score}/${maxRaw} → 정규화: ${normalized}/100`);
  breakdown.push(`✅ 성공: ${passed}  ❌ 실패: ${failed}  연속실패최대: ${maxConsecutiveFails}`);

  return {
    score: normalized,
    breakdown,
    passRate: steps.length > 0 ? (passed / steps.length) * 100 : 0,
  };
}

// ── Runner ─────────────────────────────────────────────────────
async function runHumanAgentTest() {
  console.log("\n" + "═".repeat(60));
  console.log("  HUMAN AGENT TEST — Target: 95/100");
  console.log("═".repeat(60));
  console.log(`\nURL:   ${TEST_CONFIG.targetUrl}`);
  console.log(`Goal:  ${TEST_CONFIG.goal}`);
  console.log(`Steps: max ${TEST_CONFIG.maxSteps}`);
  console.log(`Model: GPT-4o vision + Qwen3-VL OCR (cached) + GPT-4o-mini validator`);
  console.log("");

  const startTime = Date.now();
  const steps: HumanStep[] = [];
  let finalResult: HumanResult | null = null;
  let errorMessage = "";

  await new Promise<void>((resolve, reject) => {
    const bodyStr = JSON.stringify({
      targetUrl:    TEST_CONFIG.targetUrl,
      goal:         TEST_CONFIG.goal,
      loginEmail:   TEST_CONFIG.loginEmail,
      loginPassword: TEST_CONFIG.loginPassword,
      maxSteps:     TEST_CONFIG.maxSteps,
      categories:   TEST_CONFIG.categories,
    });

    const req = http.request({
      hostname: API_HOST,
      port:     API_PORT,
      path:     "/api/human-agent/run",
      method:   "POST",
      headers: {
        "Content-Type":   "application/json",
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
            const evt = JSON.parse(line.slice(6));

            if (evt.type === "start" || evt.type === "info") {
              console.log(`[INFO] ${evt.message}`);
            }

            if (evt.type === "step") {
              const s: HumanStep = evt.step;
              steps.push(s);

              const icon = s.success ? "✅" : "❌";
              const dur = `${(s.durationMs / 1000).toFixed(1)}s`;
              const planMs = `plan:${(s.planningMs / 1000).toFixed(1)}s`;
              const percMs = `perc:${(s.perceptionMs / 1000).toFixed(1)}s`;
              const action = s.decision.action.padEnd(8);
              const desc = s.decision.description.slice(0, 60);
              const errMsg = s.error ? `  ⚠ ${s.error.slice(0, 60)}` : "";
              console.log(`  ${icon} Step ${String(s.stepNumber).padStart(2)} [${action}] ${desc.padEnd(60)} ${dur} (${planMs} ${percMs})${errMsg}`);
            }

            if (evt.type === "complete") {
              finalResult = evt.result;
            }

            if (evt.type === "error") {
              errorMessage = evt.message;
              console.error(`\n[ERROR] ${evt.message}`);
            }
          } catch { /* ignore parse errors */ }
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
  console.log(`\n${"═".repeat(60)}`);

  if (!finalResult && !errorMessage) {
    console.error("\n❌ 응답 없음 — 서버가 실행 중인지 확인하세요 (npm run dev)");
    process.exit(1);
  }

  if (errorMessage && !finalResult) {
    console.error(`\n❌ 에러로 종료: ${errorMessage}`);
    process.exit(1);
  }

  const r = finalResult!;
  const { score, breakdown, passRate } = scoreRun(r);

  const statusEmoji = r.status === "done" ? "✅ 완료" : r.status === "fail" ? "❌ 실패" : "⏱ 최대스텝";

  console.log(`\n  STATUS:    ${statusEmoji}`);
  console.log(`  SCORE:     ${score}/100  (목표: ${TARGET_SCORE})`);
  console.log(`  PASS RATE: ${passRate.toFixed(1)}%  (${r.steps.filter(s => s.success).length}/${r.steps.length} 스텝)`);
  console.log(`  DURATION:  ${(r.totalDurationMs / 1000).toFixed(1)}s  (총 ${elapsed}s 포함 API 오버헤드)`);
  console.log(`  AVG/STEP:  ${(r.totalDurationMs / Math.max(r.steps.length, 1) / 1000).toFixed(1)}s`);
  console.log(`\n  ── 점수 분석 ─────────────────────────────────────────`);
  for (const b of breakdown) console.log(`  ${b}`);
  console.log(`\n  ── 요약 ──────────────────────────────────────────────`);
  console.log(`  ${r.summary}`);

  // Failed steps detail
  const failedSteps = r.steps.filter(s => !s.success);
  if (failedSteps.length > 0) {
    console.log(`\n  ── 실패 스텝 상세 ────────────────────────────────────`);
    for (const s of failedSteps) {
      console.log(`  Step ${s.stepNumber}: [${s.decision.action}] ${s.decision.description}`);
      console.log(`    오류: ${s.error}`);
    }
  }

  console.log(`\n${"═".repeat(60)}`);
  if (score >= TARGET_SCORE) {
    console.log(`\n  🎉 목표 달성: ${score} ≥ ${TARGET_SCORE}점 — PASS\n`);
    process.exit(0);
  } else {
    console.log(`\n  ⚠️  목표 미달: ${score} < ${TARGET_SCORE}점 (차이: ${TARGET_SCORE - score}점)`);
    console.log(`  개선 필요 영역:`);
    if (passRate < 80) console.log(`    - 스텝 성공률 낮음 (${passRate.toFixed(1)}% < 80%)`);
    if (r.status !== "done") console.log(`    - 목표 미완료 (${r.status})`);
    const avgMs = r.totalDurationMs / Math.max(r.steps.length, 1);
    if (avgMs > 25_000) console.log(`    - 스텝 속도 느림 (avg ${(avgMs/1000).toFixed(1)}s > 25s)`);
    console.log("");
    process.exit(1);
  }
}

runHumanAgentTest().catch((e) => {
  console.error("테스트 실행 오류:", e.message);
  process.exit(1);
});
