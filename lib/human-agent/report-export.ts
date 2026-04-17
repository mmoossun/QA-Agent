/**
 * Client-side report export utilities
 * generateReportHTML — self-contained HTML with base64-embedded screenshots
 * downloadJSON       — raw report JSON
 */

import type { TestFinding, TestReport, RiskLevel } from "@/lib/human-agent/report-generator";

// ─── Helpers ──────────────────────────────────────────────────

function esc(str: string): string {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function toBase64(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch { return null; }
}

const RISK_LABELS: Record<RiskLevel, { label: string; color: string }> = {
  low:      { label: "낮음",   color: "#16a34a" },
  medium:   { label: "보통",   color: "#ca8a04" },
  high:     { label: "높음",   color: "#ea580c" },
  critical: { label: "심각",   color: "#dc2626" },
};

const SEVERITY_COLORS: Record<string, string> = {
  critical: "#dc2626",
  high:     "#ea580c",
  medium:   "#ca8a04",
  low:      "#2563eb",
};

const FINDING_ICONS: Record<string, string> = { bug: "🐛", warning: "⚠️", info: "ℹ️" };

// ─── HTML Generator ───────────────────────────────────────────

export async function generateReportHTML(report: TestReport | ReportLike): Promise<string> {
  const risk = RISK_LABELS[report.riskLevel as RiskLevel] ?? RISK_LABELS.medium;
  const statusLabel = report.status === "done" ? "✅ 완료" : report.status === "fail" ? "❌ 버그 발견" : "⏱ 최대 스텝";
  const passCount = Math.round((report.stepCount * report.passRate) / 100);
  const bugs = report.findings.filter((f: TestFinding) => f.type === "bug");

  // Fetch & embed screenshots
  const screenshotCache = new Map<string, string>();
  const screenshotPaths = report.findings.map((f: TestFinding) => f.screenshotPath).filter(Boolean) as string[];
  // Also include step screenshots if available
  if ("steps" in report && report.steps) {
    for (const s of (report.steps as Array<{ screenshotPath?: string }> )) {
      if (s.screenshotPath) screenshotPaths.push(s.screenshotPath);
    }
  }
  await Promise.all(Array.from(new Set(screenshotPaths)).map(async (p) => {
    const b64 = await toBase64(p);
    if (b64) screenshotCache.set(p, b64);
  }));

  const img = (path?: string, cls = "", alt = "") =>
    path && screenshotCache.has(path)
      ? `<img src="${screenshotCache.get(path)}" alt="${esc(alt)}" class="${cls}">`
      : "";

  const findingsHTML = report.findings.map((f: TestFinding, i: number) => {
    const color = SEVERITY_COLORS[f.severity] ?? "#ca8a04";
    const screenshot = img(f.screenshotPath, "screenshot", `Finding ${i + 1}`);
    return `
      <div class="finding">
        <div class="finding-header">
          <span class="finding-icon">${FINDING_ICONS[f.type] ?? "•"}</span>
          <div class="finding-meta">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
              <span class="badge" style="background:${color}20;color:${color};border:1px solid ${color}40">
                <span class="dot" style="background:${color}"></span>${f.severity.charAt(0).toUpperCase() + f.severity.slice(1)}
              </span>
              <span class="step-tag">Step ${f.stepNumber}</span>
            </div>
            <strong class="finding-title">${esc(f.title)}</strong>
          </div>
        </div>
        ${screenshot ? `<div class="screenshot-wrap">${screenshot}</div>` : ""}
        <div class="finding-body">
          <div class="field">
            <div class="field-label">현상</div>
            <div class="field-value">${esc(f.description)}</div>
          </div>
          <div class="field" style="background:#fef2f2;border-color:#fecaca">
            <div class="field-label" style="color:#dc2626">🔍 근본 원인 분석</div>
            <div class="field-value">${esc(f.rootCause)}</div>
          </div>
          <div class="field">
            <div class="field-label">재현 절차</div>
            <pre class="field-value" style="white-space:pre-wrap;font-family:inherit">${esc(f.reproductionSteps)}</pre>
          </div>
          <div class="field" style="background:#eff6ff;border-color:#bfdbfe">
            <div class="field-label" style="color:#2563eb">💡 권고 사항</div>
            <div class="field-value">${esc(f.recommendation)}</div>
          </div>
        </div>
      </div>`;
  }).join("");

  const recommendationsHTML = report.recommendations.map((r: string, i: number) =>
    `<li><span class="rec-num">${i + 1}</span><span>${esc(r)}</span></li>`
  ).join("");

  const featuresHTML = report.testedFeatures.map((f: string) =>
    `<span class="feature-tag">${esc(f)}</span>`
  ).join("");

  // Step timeline (if steps available)
  let stepsHTML = "";
  if ("steps" in report && report.steps && (report.steps as unknown[]).length > 0) {
    const stepItems = (report.steps as Array<{ stepNumber: number; success: boolean; decision: { action: string; description: string }; screenshotPath?: string; durationMs: number }>)
      .map(s => {
        const shot = img(s.screenshotPath, "step-img", `Step ${s.stepNumber}`);
        return `
        <div class="step-item ${s.success ? "step-ok" : "step-fail"}">
          <div class="step-badge ${s.success ? "badge-ok" : "badge-fail"}">${s.success ? "✓" : "✗"} ${s.stepNumber}</div>
          <div class="step-action">${esc(s.decision.action)}</div>
          <div class="step-desc">${esc(s.decision.description)}</div>
          ${shot ? `<div class="step-shot-wrap">${shot}</div>` : ""}
          <div class="step-dur">${(s.durationMs / 1000).toFixed(1)}s</div>
        </div>`;
      }).join("");
    stepsHTML = `
      <section class="section">
        <h2 class="section-title">🎞️ 스텝별 실행 기록</h2>
        <div class="steps-grid">${stepItems}</div>
      </section>`;
  }

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>QA Report — ${esc(report.targetUrl)}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f9fafb;color:#111827;line-height:1.6}
  .page{max-width:900px;margin:0 auto;padding:40px 24px}

  /* Header */
  .report-header{background:linear-gradient(135deg,#111827,#374151);color:#fff;border-radius:16px;overflow:hidden;margin-bottom:24px}
  .header-body{padding:32px}
  .header-label{font-size:11px;color:#9ca3af;letter-spacing:1px;text-transform:uppercase;margin-bottom:8px}
  .header-url{font-size:20px;font-weight:700;margin-bottom:6px;word-break:break-all}
  .header-goal{font-size:14px;color:#d1d5db;margin-bottom:16px}
  .header-row{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px}
  .header-meta{font-size:12px;color:#6b7280}
  .risk-badge{padding:5px 14px;border-radius:20px;font-size:12px;font-weight:600;border:1px solid;display:inline-block}

  /* Metrics */
  .metrics{display:grid;grid-template-columns:repeat(4,1fr);border-top:1px solid #e5e7eb;background:#fff}
  .metric{padding:20px;text-align:center;border-right:1px solid #e5e7eb}
  .metric:last-child{border-right:none}
  .metric-value{font-size:26px;font-weight:700;color:#111827}
  .metric-label{font-size:11px;color:#6b7280;margin-top:2px}
  .metric-sub{font-size:11px;color:#9ca3af}

  /* Sections */
  .section{background:#fff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;margin-bottom:20px}
  .section-title{font-size:14px;font-weight:600;color:#374151;padding:16px 20px;border-bottom:1px solid #f3f4f6;background:#f9fafb;display:flex;align-items:center;gap:8px}
  .section-body{padding:20px}

  /* Summary */
  .summary-text{font-size:14px;color:#374151;line-height:1.7}
  .features{display:flex;flex-wrap:wrap;gap:6px;margin-top:16px}
  .feature-tag{font-size:12px;padding:4px 12px;background:#eff6ff;color:#2563eb;border:1px solid #bfdbfe;border-radius:20px}

  /* Findings */
  .finding{border-bottom:1px solid #f3f4f6;padding:0}
  .finding:last-child{border-bottom:none}
  .finding-header{display:flex;gap:12px;padding:20px;cursor:default}
  .finding-icon{font-size:18px;margin-top:2px;flex-shrink:0}
  .finding-meta{flex:1}
  .finding-title{font-size:14px;font-weight:600;color:#111827}
  .badge{display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:600;padding:3px 10px;border-radius:20px}
  .dot{width:8px;height:8px;border-radius:50%;display:inline-block}
  .step-tag{font-size:11px;color:#6b7280}
  .screenshot-wrap{padding:0 20px 16px;margin-top:-8px}
  .screenshot{max-height:360px;width:100%;object-fit:cover;object-position:top;border-radius:8px;border:1px solid #e5e7eb}
  .finding-body{padding:0 20px 20px;display:grid;gap:10px}
  .field{background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:12px 14px}
  .field-label{font-size:11px;font-weight:600;color:#6b7280;margin-bottom:6px;text-transform:uppercase;letter-spacing:.5px}
  .field-value{font-size:13px;color:#374151;line-height:1.6}

  /* Recommendations */
  .rec-list{list-style:none;display:grid;gap:10px;padding:20px}
  .rec-list li{display:flex;gap:12px;align-items:flex-start;font-size:14px;color:#374151}
  .rec-num{width:24px;height:24px;background:#dbeafe;color:#2563eb;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;flex-shrink:0;margin-top:1px}

  /* Steps grid */
  .steps-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;padding:20px}
  .step-item{border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;font-size:12px}
  .step-ok{border-color:#bbf7d0}
  .step-fail{border-color:#fecaca}
  .step-badge{padding:5px 10px;font-size:11px;font-weight:600}
  .badge-ok{background:#dcfce7;color:#16a34a}
  .badge-fail{background:#fee2e2;color:#dc2626}
  .step-action{padding:4px 10px;font-size:10px;color:#6b7280;background:#f9fafb;border-top:1px solid #f3f4f6}
  .step-desc{padding:6px 10px;color:#374151;line-height:1.4;font-size:11px}
  .step-shot-wrap{padding:0 8px 6px}
  .step-img{width:100%;border-radius:4px;border:1px solid #f3f4f6;object-fit:cover;object-position:top;max-height:100px}
  .step-dur{padding:4px 10px 8px;font-size:10px;color:#9ca3af}

  .footer{text-align:center;font-size:11px;color:#9ca3af;margin-top:32px;padding-bottom:40px}
  @media print{body{background:#fff}.page{padding:0}}
</style>
</head>
<body>
<div class="page">

  <div class="report-header">
    <div class="header-body">
      <div class="header-label">QA TEST REPORT</div>
      <div class="header-url">${esc(report.targetUrl)}</div>
      <div class="header-goal">${esc(report.goal || "자유 탐색 QA")}</div>
      <div class="header-row">
        <div class="header-meta">
          ${esc(new Date(report.createdAt).toLocaleString("ko-KR"))} &middot;
          ${esc(String(report.stepCount))}스텝 &middot;
          ${esc((report.totalDurationMs / 1000).toFixed(1))}s
        </div>
        <span class="risk-badge" style="background:${risk.color}20;color:${risk.color};border-color:${risk.color}40">
          위험도: ${esc(risk.label)}
        </span>
      </div>
    </div>
    <div class="metrics">
      <div class="metric">
        <div class="metric-value">${esc(statusLabel)}</div>
        <div class="metric-label">상태</div>
      </div>
      <div class="metric">
        <div class="metric-value">${esc(report.passRate.toFixed(0))}%</div>
        <div class="metric-label">성공률</div>
        <div class="metric-sub">${esc(String(passCount))}/${esc(String(report.stepCount))} 스텝</div>
      </div>
      <div class="metric">
        <div class="metric-value">${esc(String(bugs.length))}</div>
        <div class="metric-label">발견된 버그</div>
        <div class="metric-sub">${esc(String(report.findings.length))}건 총 발견사항</div>
      </div>
      <div class="metric">
        <div class="metric-value">${esc(String(report.testedFeatures.length))}</div>
        <div class="metric-label">테스트된 기능</div>
      </div>
    </div>
  </div>

  <div class="section">
    <div class="section-title">📝 종합 요약</div>
    <div class="section-body">
      <p class="summary-text">${esc(report.executiveSummary)}</p>
      ${featuresHTML ? `<div class="features">${featuresHTML}</div>` : ""}
    </div>
  </div>

  ${report.findings.length > 0 ? `
  <div class="section">
    <div class="section-title">🔍 발견사항 (${esc(String(report.findings.length))}건)</div>
    ${findingsHTML}
  </div>` : ""}

  ${report.recommendations.length > 0 ? `
  <div class="section">
    <div class="section-title">💡 개선 권고사항</div>
    <ol class="rec-list">${recommendationsHTML}</ol>
  </div>` : ""}

  ${stepsHTML}

  <div class="footer">
    Generated by QA Agent &middot; ${esc(new Date().toLocaleString("ko-KR"))}
  </div>
</div>
</body>
</html>`;
}

// ─── ReportLike interface (for saved reports without steps) ───
export interface ReportLike {
  id: string;
  createdAt: string;
  targetUrl: string;
  goal: string;
  status: "done" | "fail" | "max_steps";
  riskLevel: string;
  executiveSummary: string;
  testedFeatures: string[];
  findings: TestFinding[];
  recommendations: string[];
  passRate: number;
  totalDurationMs: number;
  stepCount: number;
  steps?: unknown[];
}

// ─── Download helpers ─────────────────────────────────────────

export function triggerDownload(content: string, filename: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function safeFilename(report: ReportLike | TestReport): string {
  const date = new Date(report.createdAt).toISOString().slice(0, 10);
  const domain = report.targetUrl.replace(/^https?:\/\//, "").replace(/[^a-z0-9]/gi, "-").slice(0, 40);
  return `qa-report-${date}-${domain}`;
}
