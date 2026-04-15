/**
 * QA Reporter — Generates structured JSON + HTML report
 */

import * as fs from "fs";
import * as path from "path";
import type { QAReport, TestResult, BugInfo, QAScenario } from "@/lib/ai/types";
import { chat } from "@/lib/ai/claude";
import { logger } from "@/lib/logger";

export class QAReporter {
  async generate(
    runId: string,
    targetUrl: string,
    scenarios: QAScenario[],
    results: TestResult[],
    duration: number,
    reportLanguage: "ko" | "en" = "ko"
  ): Promise<QAReport> {
    const passed = results.filter((r) => r.status === "pass").length;
    const failed = results.filter((r) => r.status === "fail").length;
    const errors = results.filter((r) => r.status === "error").length;
    const skipped = results.filter((r) => r.status === "skip").length;
    const total = results.length;
    const passRate = total > 0 ? (passed / total) * 100 : 0;

    // Calculate score based on pass rate and other factors
    const score = this._calculateScore(results, scenarios);

    // Extract bugs from failures
    const bugReports = this._extractBugs(results, scenarios);

    // AI-generated summary and recommendations
    const { summary, recommendations } = await this._generateInsights(results, scenarios, reportLanguage);

    const report: QAReport = {
      runId,
      targetUrl,
      timestamp: new Date().toISOString(),
      duration,
      totalScenarios: total,
      passed,
      failed,
      errors,
      skipped,
      passRate,
      score,
      scenarios: results,
      bugReports,
      summary,
      recommendations,
    };

    // Save HTML report
    await this._saveHtmlReport(report);

    return report;
  }

  private _calculateScore(results: TestResult[], scenarios: QAScenario[]): number {
    if (results.length === 0) return 0;
    const passed = results.filter((r) => r.status === "pass").length;
    const criticalPassed = results.filter((r) => {
      const sc = scenarios.find((s) => s.id === r.scenarioId);
      return sc?.priority === "critical" && r.status === "pass";
    }).length;
    const criticalTotal = scenarios.filter((s) => s.priority === "critical").length;

    const baseScore = (passed / results.length) * 100;
    const criticalBonus = criticalTotal > 0 ? (criticalPassed / criticalTotal) * 20 : 0;
    return Math.min(100, Math.round(baseScore * 0.8 + criticalBonus));
  }

  private _extractBugs(results: TestResult[], scenarios: QAScenario[]): BugInfo[] {
    return results
      .filter((r) => r.status === "fail" || r.status === "error")
      .map((r): BugInfo => {
        const scenario = scenarios.find((s) => s.id === r.scenarioId);
        return {
          title: `${r.scenarioName} failed`,
          severity: scenario?.priority === "critical" ? "critical" : scenario?.priority === "high" ? "high" : "medium",
          category: r.failureCategory ?? "logic",
          description: r.errorMessage ?? "Test failed without error message",
          steps: scenario?.steps.map((s) => s.description) ?? [],
          expected: scenario?.expectedResult ?? "",
          actual: r.errorMessage ?? "",
          screenshotUrl: r.screenshotPath,
        };
      });
  }

  private async _generateInsights(
    results: TestResult[],
    scenarios: QAScenario[],
    reportLanguage: "ko" | "en" = "ko"
  ): Promise<{ summary: string; recommendations: string[] }> {
    try {
      const data = {
        passed: results.filter((r) => r.status === "pass").length,
        failed: results.filter((r) => r.status === "fail").length,
        errors: results.filter((r) => r.status === "error").length,
        totalScenarios: results.length,
        failedScenarios: results
          .filter((r) => r.status !== "pass")
          .map((r) => ({ name: r.scenarioName, error: r.errorMessage, category: r.failureCategory })),
      };

      const isKo = reportLanguage === "ko";
      const response = await chat(
        [{
          role: "user",
          content: isKo
            ? `다음 QA 결과를 분석하여 간결한 요약과 3~5개의 실행 가능한 개선 권고를 한국어로 작성해줘:\n${JSON.stringify(data, null, 2)}\n\nJSON 형식으로만 응답: {"summary": "...", "recommendations": ["...", "..."]}`
            : `Analyze these QA results and provide a concise summary and 3-5 actionable recommendations:\n${JSON.stringify(data, null, 2)}\n\nRespond as JSON only: {"summary": "...", "recommendations": ["...", "..."]}`,
        }],
        isKo
          ? "당신은 시니어 QA 엔지니어입니다. 결과 분석과 개선 권고를 항상 한국어로 작성합니다."
          : "You are a senior QA engineer providing concise, actionable QA insights in English."
      );

      const parsed = JSON.parse(
        response.match(/\{[\s\S]*\}/)?.[0] ?? '{"summary":"QA completed","recommendations":[]}'
      );
      return parsed;
    } catch {
      const passed = results.filter((r) => r.status === "pass").length;
      return reportLanguage === "ko"
        ? {
            summary: `QA 실행 완료. 총 ${results.length}개 시나리오 중 ${passed}개 통과.`,
            recommendations: ["실패한 시나리오를 검토하세요", "불안정한 테스트에 재시도 로직을 추가하세요"],
          }
        : {
            summary: `QA run completed. ${passed}/${results.length} scenarios passed.`,
            recommendations: ["Review failed scenarios", "Add retry logic for flaky tests"],
          };
    }
  }

  private async _saveHtmlReport(report: QAReport): Promise<void> {
    const dir = path.join(process.cwd(), "public", "reports");
    fs.mkdirSync(dir, { recursive: true });

    const html = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<title>QA Report - ${report.runId}</title>
<style>
  body { font-family: system-ui; max-width: 1200px; margin: 0 auto; padding: 20px; background: #f8fafc; }
  .header { background: #1e3a8a; color: white; padding: 24px; border-radius: 12px; margin-bottom: 24px; }
  .score { font-size: 3rem; font-weight: bold; }
  .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 24px; }
  .stat { background: white; padding: 16px; border-radius: 8px; text-align: center; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
  .stat-num { font-size: 2rem; font-weight: bold; }
  .pass { color: #16a34a; } .fail { color: #dc2626; } .error { color: #d97706; }
  .scenario { background: white; margin: 8px 0; padding: 16px; border-radius: 8px; border-left: 4px solid #e5e7eb; }
  .scenario.pass { border-color: #16a34a; } .scenario.fail { border-color: #dc2626; }
  .bug { background: #fef2f2; border: 1px solid #fecaca; padding: 12px; border-radius: 8px; margin: 8px 0; }
  img { max-width: 100%; border-radius: 4px; }
</style>
</head>
<body>
<div class="header">
  <h1>QA Report</h1>
  <div>Run ID: ${report.runId} | ${new Date(report.timestamp).toLocaleString("ko-KR")}</div>
  <div>Target: <a href="${report.targetUrl}" style="color:#93c5fd">${report.targetUrl}</a></div>
  <div class="score">${report.score}/100</div>
  <div>Pass Rate: ${report.passRate.toFixed(1)}%</div>
</div>

<div class="stats">
  <div class="stat"><div class="stat-num pass">${report.passed}</div><div>PASS</div></div>
  <div class="stat"><div class="stat-num fail">${report.failed}</div><div>FAIL</div></div>
  <div class="stat"><div class="stat-num error">${report.errors}</div><div>ERROR</div></div>
  <div class="stat"><div class="stat-num">${(report.duration / 1000).toFixed(1)}s</div><div>Duration</div></div>
</div>

<h2>Summary</h2>
<p>${report.summary}</p>

<h2>Recommendations</h2>
<ul>${report.recommendations.map((r) => `<li>${r}</li>`).join("")}</ul>

<h2>Scenarios (${report.totalScenarios})</h2>
${report.scenarios
  .map(
    (r) => `<div class="scenario ${r.status}">
  <strong>${r.scenarioName}</strong> — <span class="${r.status}">${r.status.toUpperCase()}</span> (${r.duration}ms)
  ${r.errorMessage ? `<div style="color:#dc2626;margin-top:8px">${r.errorMessage}</div>` : ""}
  ${r.screenshotPath ? `<img src="${r.screenshotPath}" alt="screenshot" style="margin-top:8px;max-height:200px">` : ""}
</div>`
  )
  .join("")}

${
  report.bugReports.length > 0
    ? `<h2>Bugs Found (${report.bugReports.length})</h2>
${report.bugReports
  .map(
    (b) => `<div class="bug">
  <strong>[${b.severity.toUpperCase()}] ${b.title}</strong>
  <div>Category: ${b.category} | ${b.description}</div>
  ${b.screenshotUrl ? `<img src="${b.screenshotUrl}" alt="bug screenshot">` : ""}
</div>`
  )
  .join("")}`
    : ""
}
</body></html>`;

    fs.writeFileSync(path.join(dir, `${report.runId}.html`), html, "utf-8");
    logger.info({ path: `/reports/${report.runId}.html` }, "HTML report saved");
  }
}
