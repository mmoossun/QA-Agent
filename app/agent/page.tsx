"use client";

import { useState } from "react";
import type { QAReport } from "@/lib/ai/types";

interface AgentEvent {
  type: "start" | "progress" | "complete" | "error";
  stage?: string;
  message?: string;
  progress?: number;
  report?: QAReport;
  data?: unknown;
}

export default function AgentPage() {
  const [targetUrl, setTargetUrl] = useState("https://app-dev.generativelab.co.kr");
  const [loginEmail, setLoginEmail] = useState("qa-owner@example.com");
  const [loginPassword, setLoginPassword] = useState("TestPassword123");
  const [maxScenarios, setMaxScenarios] = useState(12);
  const [running, setRunning] = useState(false);
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [report, setReport] = useState<QAReport | null>(null);
  const [progress, setProgress] = useState(0);

  const runAgent = async () => {
    setRunning(true);
    setEvents([]);
    setReport(null);
    setProgress(0);

    try {
      const res = await fetch("/api/agent/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetUrl, loginEmail, loginPassword, maxScenarios }),
      });

      if (!res.body) throw new Error("No response body");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const event: AgentEvent = JSON.parse(line.slice(6));
            setEvents((prev) => [...prev, event]);
            if (event.progress !== undefined) setProgress(event.progress);
            if (event.type === "complete" && event.report) setReport(event.report);
          } catch {
            // ignore parse errors
          }
        }
      }
    } catch (err) {
      setEvents((prev) => [...prev, { type: "error", message: String(err) }]);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-6 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">Autonomous QA Agent</h1>
        <p className="text-gray-500">URL과 계정 정보만 입력하면 AI가 전체 QA를 자동으로 수행합니다</p>
      </div>

      <div className="grid grid-cols-3 gap-6 mb-6">
        {/* Config */}
        <div className="col-span-1 card p-5 space-y-4">
          <h2 className="font-semibold text-gray-900">설정</h2>
          <div>
            <label className="text-xs font-medium text-gray-500 block mb-1">대상 URL *</label>
            <input
              className="input"
              value={targetUrl}
              onChange={(e) => setTargetUrl(e.target.value)}
              placeholder="https://your-app.com"
              disabled={running}
            />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-500 block mb-1">이메일 (선택)</label>
            <input
              className="input"
              value={loginEmail}
              onChange={(e) => setLoginEmail(e.target.value)}
              type="email"
              disabled={running}
            />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-500 block mb-1">비밀번호 (선택)</label>
            <input
              className="input"
              value={loginPassword}
              onChange={(e) => setLoginPassword(e.target.value)}
              type="password"
              disabled={running}
            />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-500 block mb-1">
              최대 시나리오 수: {maxScenarios}
            </label>
            <input
              type="range"
              min={5}
              max={30}
              value={maxScenarios}
              onChange={(e) => setMaxScenarios(Number(e.target.value))}
              className="w-full"
              disabled={running}
            />
          </div>
          <button
            onClick={runAgent}
            disabled={running || !targetUrl}
            className="btn-primary w-full"
          >
            {running ? "실행 중..." : "에이전트 시작"}
          </button>
        </div>

        {/* Progress + Log */}
        <div className="col-span-2 card p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-900">실행 로그</h2>
            {running && (
              <div className="text-sm text-blue-600 font-medium">{progress}%</div>
            )}
          </div>

          {running && (
            <div className="mb-4">
              <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-500 rounded-full transition-all duration-500"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )}

          <div className="h-64 overflow-y-auto space-y-2 font-mono text-xs">
            {events.length === 0 && !running && (
              <div className="text-gray-400 text-center py-8">에이전트를 시작하면 여기에 로그가 표시됩니다</div>
            )}
            {events.map((e, i) => (
              <div
                key={i}
                className={`flex gap-2 ${
                  e.type === "error" ? "text-red-600" : e.type === "complete" ? "text-green-600" : "text-gray-600"
                }`}
              >
                <span className="text-gray-300 shrink-0">{String(i + 1).padStart(2, "0")}</span>
                <span className="uppercase text-blue-500 shrink-0 w-16">[{e.stage ?? e.type}]</span>
                <span>{e.message}</span>
                {e.progress !== undefined && (
                  <span className="text-gray-400 ml-auto">{e.progress}%</span>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Report */}
      {report && <ReportView report={report} />}
    </div>
  );
}

function ReportView({ report }: { report: QAReport }) {
  return (
    <div className="card p-6 space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900">QA Report</h2>
          <p className="text-sm text-gray-500">{new Date(report.timestamp).toLocaleString("ko-KR")}</p>
        </div>
        <div className="text-right">
          <div className="text-4xl font-bold text-blue-600">{report.score}</div>
          <div className="text-sm text-gray-400">/ 100</div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: "PASS", value: report.passed, color: "text-green-600", bg: "bg-green-50" },
          { label: "FAIL", value: report.failed, color: "text-red-600", bg: "bg-red-50" },
          { label: "ERROR", value: report.errors, color: "text-yellow-600", bg: "bg-yellow-50" },
          { label: "Pass Rate", value: `${report.passRate.toFixed(1)}%`, color: "text-blue-600", bg: "bg-blue-50" },
        ].map((s) => (
          <div key={s.label} className={`${s.bg} rounded-xl p-4 text-center`}>
            <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
            <div className="text-xs text-gray-500 mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Summary */}
      <div>
        <h3 className="font-semibold text-gray-900 mb-2">Summary</h3>
        <p className="text-sm text-gray-600">{report.summary}</p>
      </div>

      {/* Recommendations */}
      {report.recommendations.length > 0 && (
        <div>
          <h3 className="font-semibold text-gray-900 mb-2">Recommendations</h3>
          <ul className="space-y-1.5">
            {report.recommendations.map((r, i) => (
              <li key={i} className="flex gap-2 text-sm text-gray-600">
                <span className="text-blue-500 shrink-0">→</span>
                {r}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Bugs */}
      {report.bugReports.length > 0 && (
        <div>
          <h3 className="font-semibold text-gray-900 mb-2">
            Bugs Found ({report.bugReports.length})
          </h3>
          <div className="space-y-2">
            {report.bugReports.map((bug, i) => (
              <div
                key={i}
                className={`p-3 rounded-lg border text-sm ${
                  bug.severity === "critical" || bug.severity === "high"
                    ? "bg-red-50 border-red-200"
                    : "bg-yellow-50 border-yellow-200"
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className={`badge-${bug.severity === "critical" || bug.severity === "high" ? "fail" : "error"}`}>
                    {bug.severity.toUpperCase()}
                  </span>
                  <span className="font-medium">{bug.title}</span>
                </div>
                <p className="text-gray-600 text-xs">{bug.description}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Scenario results */}
      <div>
        <h3 className="font-semibold text-gray-900 mb-2">
          Scenarios ({report.totalScenarios})
        </h3>
        <div className="space-y-1.5">
          {report.scenarios.map((r) => (
            <div key={r.scenarioId} className="flex items-center gap-3 py-2 border-b last:border-0">
              <span className={`badge-${r.status}`}>{r.status.toUpperCase()}</span>
              <span className="text-sm flex-1">{r.scenarioName}</span>
              <span className="text-xs text-gray-400">{(r.duration / 1000).toFixed(1)}s</span>
              {r.screenshotPath && (
                <a href={r.screenshotPath} target="_blank" className="text-xs text-blue-500 hover:underline">
                  screenshot
                </a>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
