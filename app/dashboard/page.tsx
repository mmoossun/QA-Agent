"use client";

import { useEffect, useState } from "react";

interface RunRecord {
  id: string;
  mode: "chat" | "quick" | "agent";
  targetUrl: string;
  scenarioCount: number;
  passCount: number;
  failCount: number;
  score: number | null;
  passRate: number;
  duration: number;
  status: "completed" | "failed";
  createdAt: string;
  summary?: string;
}

function modeLabel(mode: string) {
  if (mode === "agent") return { text: "Auto Agent", cls: "bg-purple-100 text-purple-700" };
  if (mode === "quick") return { text: "Quick Run", cls: "bg-blue-100 text-blue-700" };
  return { text: "Chat QA", cls: "bg-green-100 text-green-700" };
}

function scoreColor(score: number | null) {
  if (score === null) return "text-gray-400";
  if (score >= 80) return "text-green-600";
  if (score >= 60) return "text-yellow-600";
  return "text-red-600";
}

function relativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "방금 전";
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  return `${Math.floor(hr / 24)}일 전`;
}

export default function DashboardPage() {
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/runs?limit=50")
      .then((r) => r.json())
      .then((d) => setRuns(d.runs ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const totalRuns = runs.length;
  const latestScore = runs.find((r) => r.score !== null)?.score ?? null;
  const avgPassRate =
    runs.length > 0
      ? runs.reduce((s, r) => s + r.passRate, 0) / runs.length
      : null;
  const bugsFound = runs.reduce((s, r) => s + r.failCount, 0);

  return (
    <div className="max-w-5xl mx-auto px-6 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">Dashboard</h1>
        <p className="text-gray-500">QA 실행 기록 및 점수 추이</p>
      </div>

      {/* Score summary */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        {[
          {
            label: "Current Score",
            value: latestScore !== null ? latestScore.toFixed(0) : "—",
            color: scoreColor(latestScore),
          },
          {
            label: "Total Runs",
            value: totalRuns > 0 ? String(totalRuns) : "—",
            color: "text-gray-700",
          },
          {
            label: "Avg Pass Rate",
            value: avgPassRate !== null ? `${avgPassRate.toFixed(1)}%` : "—",
            color: "text-green-600",
          },
          {
            label: "Bugs Found",
            value: bugsFound > 0 ? String(bugsFound) : "—",
            color: "text-red-600",
          },
        ].map((s) => (
          <div key={s.label} className="card p-5">
            <div className={`text-3xl font-bold ${s.color}`}>{s.value}</div>
            <div className="text-xs text-gray-500 mt-1">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Recent runs */}
      <div className="card p-6">
        <h2 className="font-semibold text-gray-900 mb-4">Recent QA Runs</h2>

        {loading ? (
          <div className="text-sm text-gray-400 text-center py-12">불러오는 중...</div>
        ) : runs.length === 0 ? (
          <div className="text-sm text-gray-400 text-center py-12">
            QA 실행 이력이 없습니다.<br />
            <a href="/run" className="text-blue-500 hover:underline">Quick Run</a>,{" "}
            <a href="/chat" className="text-blue-500 hover:underline">Chat QA</a> 또는{" "}
            <a href="/agent" className="text-blue-500 hover:underline">Auto Agent</a>를 먼저 실행해보세요.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-400 border-b border-gray-100">
                  <th className="pb-2 pr-4 font-medium">모드</th>
                  <th className="pb-2 pr-4 font-medium">URL</th>
                  <th className="pb-2 pr-4 font-medium text-right">Score</th>
                  <th className="pb-2 pr-4 font-medium text-right">Pass Rate</th>
                  <th className="pb-2 pr-4 font-medium text-right">시나리오</th>
                  <th className="pb-2 pr-4 font-medium text-right">소요시간</th>
                  <th className="pb-2 font-medium text-right">실행시각</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => {
                  const { text, cls } = modeLabel(run.mode);
                  return (
                    <tr key={run.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                      <td className="py-2.5 pr-4">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${cls}`}>{text}</span>
                      </td>
                      <td className="py-2.5 pr-4 max-w-[200px]">
                        <span className="text-gray-600 truncate block text-xs" title={run.targetUrl}>
                          {run.targetUrl.replace(/^https?:\/\//, "")}
                        </span>
                      </td>
                      <td className={`py-2.5 pr-4 text-right font-bold ${scoreColor(run.score)}`}>
                        {run.score !== null ? run.score.toFixed(0) : "—"}
                      </td>
                      <td className="py-2.5 pr-4 text-right text-gray-700">
                        {run.passRate.toFixed(1)}%
                      </td>
                      <td className="py-2.5 pr-4 text-right text-gray-500">
                        <span className="text-green-600">{run.passCount}✓</span>
                        {" "}
                        {run.failCount > 0 && <span className="text-red-500">{run.failCount}✗</span>}
                      </td>
                      <td className="py-2.5 pr-4 text-right text-gray-400 text-xs">
                        {run.duration < 60_000
                          ? `${(run.duration / 1000).toFixed(0)}s`
                          : `${(run.duration / 60_000).toFixed(1)}m`}
                      </td>
                      <td className="py-2.5 text-right text-gray-400 text-xs whitespace-nowrap">
                        {relativeTime(run.createdAt)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
