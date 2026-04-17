"use client";

import { useEffect, useState } from "react";
import type { TestFinding } from "@/lib/human-agent/report-generator";
import type { HumanStep } from "@/lib/human-agent/runner";
import { generateReportHTML, triggerDownload, safeFilename } from "@/lib/human-agent/report-export";

// ─── Types ─────────────────────────────────────────────────────
interface ReportListItem {
  id: string;
  name: string;
  savedAt: string;
  createdAt: string;
  targetUrl: string;
  goal: string;
  status: "done" | "fail" | "max_steps";
  riskLevel: "low" | "medium" | "high" | "critical";
  passRate: number;
  stepCount: number;
  totalDurationMs: number;
  executiveSummary: string;
  findings: TestFinding[];
  recommendations: string[];
  testedFeatures: string[];
  steps?: HumanStep[];  // loaded on demand when report is selected
}

// ─── Config maps ───────────────────────────────────────────────
const RISK_CONFIG: Record<string, { label: string; bg: string; text: string; border: string }> = {
  low:      { label: "낮음",   bg: "bg-green-50",  text: "text-green-700",  border: "border-green-200" },
  medium:   { label: "보통",   bg: "bg-yellow-50", text: "text-yellow-700", border: "border-yellow-200" },
  high:     { label: "높음",   bg: "bg-orange-50", text: "text-orange-700", border: "border-orange-200" },
  critical: { label: "심각",   bg: "bg-red-50",    text: "text-red-700",    border: "border-red-200" },
};
const SEVERITY_CONFIG: Record<string, { label: string; dot: string; text: string; rowBg: string }> = {
  critical: { label: "Critical", dot: "bg-red-500",    text: "text-red-700",    rowBg: "bg-red-50" },
  high:     { label: "High",     dot: "bg-orange-500", text: "text-orange-700", rowBg: "bg-orange-50" },
  medium:   { label: "Medium",   dot: "bg-yellow-500", text: "text-yellow-700", rowBg: "bg-yellow-50" },
  low:      { label: "Low",      dot: "bg-blue-400",   text: "text-blue-700",   rowBg: "bg-blue-50" },
};
const FINDING_ICON: Record<string, string> = { bug: "🐛", warning: "⚠️", info: "ℹ️" };

// ─── Page ──────────────────────────────────────────────────────
export default function ReportsPage() {
  const [reports, setReports]         = useState<ReportListItem[]>([]);
  const [loading, setLoading]         = useState(true);
  const [selected, setSelected]       = useState<ReportListItem | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [deleting, setDeleting]       = useState<string | null>(null);
  const [expandedFinding, setExpandedFinding] = useState<number | null>(null);
  const [search, setSearch]           = useState("");

  const loadReports = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/reports/save");
      const data = await res.json();
      setReports(data.reports ?? []);
    } catch {}
    finally { setLoading(false); }
  };

  // Fetch full report (with steps) when a report is selected
  const selectReport = async (r: ReportListItem) => {
    setSelected(r);
    setExpandedFinding(null);
    if (r.steps !== undefined) return; // already loaded
    setLoadingDetail(true);
    try {
      const res = await fetch(`/api/reports/save?id=${r.id}`);
      const data = await res.json();
      if (data.report) {
        setSelected(data.report as ReportListItem);
        setReports(prev => prev.map(p => p.id === r.id ? { ...p, steps: data.report.steps } : p));
      }
    } catch {}
    finally { setLoadingDetail(false); }
  };

  useEffect(() => { loadReports(); }, []);

  const handleDelete = async (id: string) => {
    if (!confirm("이 리포트를 삭제하시겠습니까?")) return;
    setDeleting(id);
    try {
      await fetch(`/api/reports/save?id=${id}`, { method: "DELETE" });
      if (selected?.id === id) setSelected(null);
      await loadReports();
    } finally { setDeleting(null); }
  };

  const filtered = reports.filter(r =>
    !search ||
    r.name.toLowerCase().includes(search.toLowerCase()) ||
    r.targetUrl.toLowerCase().includes(search.toLowerCase()) ||
    r.goal.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="flex h-[calc(100vh-56px)]">

      {/* ── Left: Report List ─────────────────────────────── */}
      <div className="w-80 shrink-0 border-r bg-gray-50 flex flex-col">
        <div className="p-4 border-b bg-white">
          <h2 className="font-semibold text-gray-800 text-sm">저장된 리포트</h2>
          <p className="text-xs text-gray-500 mt-0.5">{reports.length}개</p>
          <input
            className="w-full mt-3 text-xs border border-gray-200 rounded-lg px-3 py-2 outline-none focus:border-blue-400"
            placeholder="리포트 검색..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading && (
            <div className="flex items-center justify-center h-32">
              <span className="w-6 h-6 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
            </div>
          )}

          {!loading && filtered.length === 0 && (
            <div className="flex flex-col items-center justify-center h-48 text-gray-400 gap-2">
              <span className="text-4xl">📄</span>
              <p className="text-sm">{search ? "검색 결과 없음" : "저장된 리포트 없음"}</p>
              <p className="text-xs text-gray-300">테스트 완료 후 리포트를 저장하세요</p>
            </div>
          )}

          {filtered.map(r => {
            const risk = RISK_CONFIG[r.riskLevel] ?? RISK_CONFIG.medium;
            const statusIcon = r.status === "done" ? "✅" : r.status === "fail" ? "❌" : "⏱";
            const bugs = r.findings.filter(f => f.type === "bug").length;
            const isActive = selected?.id === r.id;

            return (
              <div key={r.id}
                className={`border-b cursor-pointer transition-colors ${isActive ? "bg-blue-50 border-l-2 border-l-blue-500" : "hover:bg-white"}`}
                onClick={() => selectReport(r)}>
                <div className="px-4 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-gray-800 truncate">{r.name}</p>
                      <p className="text-xs text-gray-500 truncate mt-0.5">{r.targetUrl}</p>
                    </div>
                    <button
                      onClick={e => { e.stopPropagation(); handleDelete(r.id); }}
                      disabled={deleting === r.id}
                      className="text-gray-300 hover:text-red-500 transition-colors shrink-0 mt-0.5"
                      title="삭제">
                      {deleting === r.id ? "…" : "✕"}
                    </button>
                  </div>
                  <div className="flex items-center gap-2 mt-2 flex-wrap">
                    <span className="text-sm">{statusIcon}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${risk.bg} ${risk.text} ${risk.border}`}>
                      {risk.label}
                    </span>
                    {bugs > 0 && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-red-50 text-red-600 border border-red-100">
                        🐛 {bugs}건
                      </span>
                    )}
                    <span className="text-xs text-gray-400 ml-auto">
                      {r.passRate.toFixed(0)}% 성공
                    </span>
                  </div>
                  <p className="text-xs text-gray-400 mt-1">
                    {new Date(r.savedAt).toLocaleDateString("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Right: Report Detail ──────────────────────────── */}
      <div className="flex-1 overflow-y-auto bg-gray-50">
        {!selected ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-400 gap-3">
            <span className="text-6xl">📊</span>
            <p className="text-sm">리포트를 선택하세요</p>
            <p className="text-xs text-gray-300">왼쪽 목록에서 리포트를 클릭하면 상세 내용이 표시됩니다</p>
          </div>
        ) : (
          <ReportDetail
            report={selected}
            loadingDetail={loadingDetail}
            expandedFinding={expandedFinding}
            onToggleFinding={idx => setExpandedFinding(expandedFinding === idx ? null : idx)}
            onDelete={() => handleDelete(selected.id)}
          />
        )}
      </div>
    </div>
  );
}

// ─── Report Detail ─────────────────────────────────────────────
function ReportDetail({
  report, loadingDetail, expandedFinding, onToggleFinding, onDelete,
}: {
  report: ReportListItem;
  loadingDetail: boolean;
  expandedFinding: number | null;
  onToggleFinding: (idx: number) => void;
  onDelete: () => void;
}) {
  const [downloading, setDownloading] = useState<"html" | "json" | null>(null);
  const risk = RISK_CONFIG[report.riskLevel] ?? RISK_CONFIG.medium;
  const statusIcon = report.status === "done" ? "✅" : report.status === "fail" ? "❌" : "⏱";
  const statusLabel = report.status === "done" ? "완료" : report.status === "fail" ? "버그 발견" : "최대 스텝";
  const bugs = report.findings.filter(f => f.type === "bug");
  const warnings = report.findings.filter(f => f.type === "warning");

  const downloadHTML = async () => {
    if (downloading) return;
    setDownloading("html");
    try {
      const html = await generateReportHTML(report);
      triggerDownload(html, `${safeFilename(report)}.html`, "text/html;charset=utf-8");
    } finally { setDownloading(null); }
  };

  const downloadJSON = () => {
    if (downloading) return;
    setDownloading("json");
    try {
      triggerDownload(JSON.stringify(report, null, 2), `${safeFilename(report)}.json`, "application/json");
    } finally { setDownloading(null); }
  };

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">

      {/* Header */}
      <div className="rounded-xl border border-gray-200 overflow-hidden shadow-sm">
        <div className="px-6 py-5 bg-gradient-to-r from-gray-900 to-gray-700 text-white">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <p className="text-xs text-gray-400 mb-1">QA TEST REPORT</p>
              <h2 className="text-lg font-bold truncate">{report.targetUrl}</h2>
              <p className="text-sm text-gray-300 mt-1 line-clamp-2">{report.goal || "자유 탐색 QA"}</p>
            </div>
            <div className="flex flex-col items-end gap-2 shrink-0">
              <span className="text-2xl">{statusIcon}</span>
              <span className={`text-xs px-3 py-1 rounded-full font-semibold border ${risk.bg} ${risk.text} ${risk.border}`}>
                위험도: {risk.label}
              </span>
            </div>
          </div>
          <div className="flex items-center justify-between mt-3 flex-wrap gap-2">
            <p className="text-xs text-gray-500">
              저장: {new Date(report.savedAt).toLocaleString("ko-KR")} · {report.stepCount}스텝 · {(report.totalDurationMs / 1000).toFixed(1)}s
            </p>
            <div className="flex items-center gap-2">
              <button onClick={downloadHTML} disabled={!!downloading}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white transition-colors disabled:opacity-60">
                {downloading === "html"
                  ? <><span className="w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin" />생성 중...</>
                  : <>⬇ HTML</>}
              </button>
              <button onClick={downloadJSON} disabled={!!downloading}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-600 hover:bg-gray-500 text-white transition-colors disabled:opacity-60">
                ⬇ JSON
              </button>
              <button onClick={onDelete}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-red-900/50 text-red-300 hover:bg-red-800 transition-colors">
                🗑 삭제
              </button>
            </div>
          </div>
        </div>

        {/* Metrics */}
        <div className="grid grid-cols-4 divide-x bg-white">
          {[
            { label: "상태",        value: `${statusIcon} ${statusLabel}`, sub: "" },
            { label: "성공률",      value: `${report.passRate.toFixed(0)}%`, sub: `${report.stepCount}스텝` },
            { label: "발견된 버그", value: String(bugs.length), sub: warnings.length > 0 ? `경고 ${warnings.length}건` : "경고 없음" },
            { label: "위험도",      value: risk.label, sub: report.riskLevel },
          ].map(m => (
            <div key={m.label} className="px-5 py-4 text-center">
              <p className="text-xl font-bold text-gray-800">{m.value}</p>
              <p className="text-xs text-gray-500 mt-0.5">{m.label}</p>
              {m.sub && <p className="text-xs text-gray-400">{m.sub}</p>}
            </div>
          ))}
        </div>
      </div>

      {/* Executive Summary */}
      <div className="rounded-xl border border-gray-200 bg-white p-5">
        <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
          <span className="w-5 h-5 bg-blue-100 text-blue-600 rounded flex items-center justify-center text-xs">📝</span>
          종합 요약
        </h3>
        <p className="text-sm text-gray-700 leading-relaxed">{report.executiveSummary}</p>
        {report.testedFeatures.length > 0 && (
          <div className="mt-4">
            <p className="text-xs font-semibold text-gray-500 mb-2">테스트된 기능</p>
            <div className="flex flex-wrap gap-1.5">
              {report.testedFeatures.map((f, i) => (
                <span key={i} className="text-xs px-2.5 py-1 bg-blue-50 text-blue-700 rounded-full border border-blue-100">{f}</span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Findings */}
      {report.findings.length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
          <div className="px-5 py-4 border-b bg-gray-50">
            <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
              🔍 발견사항 ({report.findings.length}건)
            </h3>
          </div>
          <div className="divide-y">
            {report.findings.map((f, idx) => {
              const sev = SEVERITY_CONFIG[f.severity] ?? SEVERITY_CONFIG.medium;
              const expanded = expandedFinding === idx;
              return (
                <div key={idx} className="hover:bg-gray-50 transition-colors">
                  <button onClick={() => onToggleFinding(idx)}
                    className="w-full px-5 py-4 flex items-start gap-3 text-left">
                    <span className="text-base shrink-0 mt-0.5">{FINDING_ICON[f.type] ?? "•"}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className={`flex items-center gap-1 text-xs font-semibold ${sev.text}`}>
                          <span className={`w-2 h-2 rounded-full ${sev.dot}`} />
                          {sev.label}
                        </span>
                        <span className="text-xs text-gray-400">Step {f.stepNumber}</span>
                      </div>
                      <p className="text-sm font-medium text-gray-800">{f.title}</p>
                      <p className="text-xs text-gray-500 mt-0.5 line-clamp-1">{f.description}</p>
                    </div>
                    <svg className={`w-4 h-4 text-gray-400 shrink-0 mt-1 transition-transform ${expanded ? "rotate-180" : ""}`}
                      fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>

                  {expanded && (
                    <div className="px-5 pb-5 space-y-3 bg-gray-50 border-t">
                      {f.screenshotPath && (
                        <div className="pt-4">
                          <p className="text-xs font-semibold text-gray-500 mb-2">📸 스크린샷 (Step {f.stepNumber})</p>
                          <a href={f.screenshotPath} target="_blank" rel="noopener noreferrer">
                            <img src={f.screenshotPath} alt={`Finding ${idx + 1}`}
                              className="rounded-lg border max-h-72 object-top object-cover w-full cursor-pointer hover:opacity-90 transition-opacity shadow-sm" />
                          </a>
                        </div>
                      )}
                      <div className="grid grid-cols-1 gap-3 pt-2">
                        <div>
                          <p className="text-xs font-semibold text-gray-500 mb-1">현상</p>
                          <p className="text-sm text-gray-700 bg-white rounded-lg border px-3 py-2.5 leading-relaxed">{f.description}</p>
                        </div>
                        <div>
                          <p className="text-xs font-semibold text-red-500 mb-1">🔍 근본 원인 분석</p>
                          <p className="text-sm text-gray-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2.5 leading-relaxed">{f.rootCause}</p>
                        </div>
                        <div>
                          <p className="text-xs font-semibold text-gray-500 mb-1">재현 절차</p>
                          <pre className="text-xs text-gray-700 bg-white rounded-lg border px-3 py-2.5 whitespace-pre-wrap font-sans leading-relaxed">{f.reproductionSteps}</pre>
                        </div>
                        <div>
                          <p className="text-xs font-semibold text-blue-600 mb-1">💡 권고 사항</p>
                          <p className="text-sm text-gray-700 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2.5 leading-relaxed">{f.recommendation}</p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Recommendations */}
      {report.recommendations.length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
            <span>💡</span> 개선 권고사항
          </h3>
          <ol className="space-y-2">
            {report.recommendations.map((r, i) => (
              <li key={i} className="flex gap-3 text-sm text-gray-700">
                <span className="w-5 h-5 bg-blue-100 text-blue-700 rounded-full flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">{i + 1}</span>
                <span className="leading-relaxed">{r}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* Step log */}
      {loadingDetail && (
        <div className="rounded-xl border border-gray-200 bg-white p-8 flex items-center justify-center gap-3 text-gray-400">
          <span className="w-5 h-5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
          <span className="text-sm">스텝 기록 불러오는 중…</span>
        </div>
      )}
      {!loadingDetail && report.steps && report.steps.length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
          <div className="px-5 py-4 border-b bg-gray-50 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-700">🎞️ 스텝별 실행 기록</h3>
            <span className="text-xs text-gray-400">{report.steps.length}스텝</span>
          </div>
          <div className="divide-y">
            {report.steps.map(step => <StepRecord key={step.stepNumber} step={step} />)}
          </div>
        </div>
      )}

    </div>
  );
}

// ─── Step Record ────────────────────────────────────────────────
const ACTION_COLORS: Record<string, string> = {
  click: "bg-blue-100 text-blue-700", fill: "bg-purple-100 text-purple-700",
  navigate: "bg-gray-100 text-gray-600", wait: "bg-yellow-100 text-yellow-700",
  scroll: "bg-cyan-100 text-cyan-700", press: "bg-orange-100 text-orange-700",
  done: "bg-green-100 text-green-700", fail: "bg-red-100 text-red-700",
  type: "bg-purple-100 text-purple-700", select: "bg-indigo-100 text-indigo-700",
  hover: "bg-pink-100 text-pink-700",
};
const ACTION_ICONS: Record<string, string> = {
  click: "👆", fill: "✏️", navigate: "🌐", wait: "⏳",
  scroll: "📜", press: "⌨️", done: "✅", fail: "❌",
  type: "⌨️", select: "🔽", hover: "🖱️",
};

function StepRecord({ step }: { step: HumanStep }) {
  const [expanded, setExpanded] = useState(false);
  const { success, decision, stepNumber, screenshotPath, durationMs } = step;
  const colorClass = ACTION_COLORS[decision.action] ?? "bg-gray-100 text-gray-600";
  const icon = ACTION_ICONS[decision.action] ?? "•";

  return (
    <div className={!success ? "bg-red-50" : ""}>
      <button onClick={() => setExpanded(v => !v)}
        className="w-full px-5 py-3 flex items-start gap-3 hover:bg-gray-50 transition-colors text-left">
        <span className={`w-6 h-6 rounded-full text-xs flex items-center justify-center shrink-0 mt-0.5 font-medium ${success ? "bg-gray-200 text-gray-600" : "bg-red-200 text-red-700"}`}>
          {stepNumber}
        </span>
        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full shrink-0 mt-0.5 ${colorClass}`}>
          {icon} {decision.action}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm text-gray-800 leading-snug">{decision.description}</p>
          {!success && step.error && (
            <p className="text-xs text-red-500 mt-0.5 truncate">⚠ {step.error}</p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs text-gray-400">{(durationMs / 1000).toFixed(1)}s</span>
          <svg className={`w-4 h-4 text-gray-400 transition-transform ${expanded ? "rotate-180" : ""}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {expanded && (
        <div className="px-5 pb-4 space-y-3 bg-gray-50 border-t">
          {screenshotPath && (
            <div className="pt-3">
              <p className="text-xs font-semibold text-gray-500 mb-2">📸 스크린샷</p>
              <a href={screenshotPath} target="_blank" rel="noopener noreferrer">
                <img src={screenshotPath} alt={`Step ${stepNumber}`}
                  className="rounded-lg border max-h-64 object-top object-cover w-full cursor-pointer hover:opacity-90 transition-opacity shadow-sm" />
              </a>
            </div>
          )}
          {decision.observation && (
            <div className="pt-1">
              <p className="text-xs font-semibold text-gray-500 mb-1">페이지 상태</p>
              <p className="text-xs text-gray-700 bg-white rounded-lg border px-3 py-2">{decision.observation}</p>
            </div>
          )}
          {step.perception && (
            <div>
              <p className="text-xs font-semibold text-gray-500 mb-1">화면 인식</p>
              <p className="text-xs text-gray-600 bg-white rounded-lg border px-3 py-2 leading-relaxed line-clamp-3">{step.perception}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
