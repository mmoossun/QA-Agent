"use client";

import { useState } from "react";
import type { QAReport } from "@/lib/ai/types";

// ─── Types ─────────────────────────────────────────────────────
interface TargetEntry {
  id: string;
  label: string;
  url: string;
  loginEmail: string;
  loginPassword: string;
  enabled: boolean;
}

type Category = "auth" | "form" | "ui" | "navigation" | "security" | "api" | "performance";

const CATEGORIES: { id: Category; label: string; desc: string; emoji: string }[] = [
  { id: "auth",        label: "인증",   desc: "로그인·로그아웃·권한",     emoji: "🔐" },
  { id: "form",        label: "폼",     desc: "입력·유효성검사·제출",      emoji: "📝" },
  { id: "ui",          label: "UI",     desc: "렌더링·레이아웃·반응형",    emoji: "🎨" },
  { id: "navigation",  label: "네비게이션", desc: "페이지 이동·링크·라우팅", emoji: "🗺️" },
  { id: "security",    label: "보안",   desc: "XSS·CSRF·접근제어",        emoji: "🛡️" },
  { id: "api",         label: "API",    desc: "요청·응답·에러 핸들링",     emoji: "⚡" },
  { id: "performance", label: "성능",   desc: "로드 속도·렌더링 시간",     emoji: "📈" },
];

interface AgentEvent {
  type: "start" | "progress" | "complete" | "error";
  stage?: string;
  message?: string;
  progress?: number;
  report?: QAReport;
}

interface TargetResult {
  target: TargetEntry;
  events: AgentEvent[];
  report: QAReport | null;
  status: "pending" | "running" | "done" | "error";
}

const DEFAULT_TARGETS: TargetEntry[] = [
  { id: "t1", label: "대시보드 (상담원용)",  url: "https://app-dev.generativelab.co.kr",                        loginEmail: "qa-owner@example.com", loginPassword: "TestPassword123", enabled: true  },
  { id: "t2", label: "위젯 데모 (고객 채팅)", url: "https://d22ekkgk95jcrg.cloudfront.net/demo/index.html", loginEmail: "",                     loginPassword: "",               enabled: false },
];

// ─── Page ──────────────────────────────────────────────────────
export default function AgentPage() {
  const [targets, setTargets]           = useState<TargetEntry[]>(DEFAULT_TARGETS);
  const [categories, setCategories]     = useState<Set<Category>>(new Set(CATEGORIES.map((c) => c.id)));
  const [maxScenarios, setMaxScenarios] = useState(12);
  const [isRunning, setIsRunning]       = useState(false);
  const [results, setResults]           = useState<TargetResult[]>([]);

  // ── Target management ─────────────────────────────────────
  const addTarget = () =>
    setTargets((prev) => [...prev, { id: `t${Date.now()}`, label: `URL ${prev.length + 1}`, url: "", loginEmail: "", loginPassword: "", enabled: true }]);

  const removeTarget = (id: string) => setTargets((prev) => prev.filter((t) => t.id !== id));

  const updateTarget = <K extends keyof TargetEntry>(id: string, field: K, val: TargetEntry[K]) =>
    setTargets((prev) => prev.map((t) => (t.id === id ? { ...t, [field]: val } : t)));

  const toggleCategory = (cat: Category) =>
    setCategories((prev) => {
      const next = new Set(prev);
      next.has(cat) ? next.delete(cat) : next.add(cat);
      return next;
    });

  // ── Run ────────────────────────────────────────────────────
  const run = async () => {
    const active = targets.filter((t) => t.enabled && t.url.trim());
    if (active.length === 0) return;

    setIsRunning(true);
    const initial: TargetResult[] = active.map((t) => ({
      target: t, events: [], report: null, status: "pending",
    }));
    setResults(initial);

    for (let i = 0; i < active.length; i++) {
      const target = active[i];

      setResults((prev) => prev.map((r, idx) => idx === i ? { ...r, status: "running" } : r));

      try {
        const res = await fetch("/api/agent/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            targetUrl: target.url,
            loginEmail: target.loginEmail || undefined,
            loginPassword: target.loginPassword || undefined,
            maxScenarios,
            scenarioCategories: Array.from(categories),
          }),
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
              setResults((prev) =>
                prev.map((r, idx) => {
                  if (idx !== i) return r;
                  const updated = { ...r, events: [...r.events, event] };
                  if (event.type === "complete" && event.report) {
                    updated.report = event.report;
                    updated.status = "done";
                  }
                  if (event.type === "error") updated.status = "error";
                  return updated;
                })
              );
            } catch { /* ignore parse errors */ }
          }
        }

        setResults((prev) =>
          prev.map((r, idx) => idx === i && r.status === "running" ? { ...r, status: "done" } : r)
        );
      } catch (err) {
        setResults((prev) =>
          prev.map((r, idx) =>
            idx === i ? { ...r, status: "error", events: [...r.events, { type: "error", message: String(err) }] } : r
          )
        );
      }
    }

    setIsRunning(false);
  };

  const activeCount = targets.filter((t) => t.enabled && t.url.trim()).length;

  return (
    <div className="max-w-6xl mx-auto px-6 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">Autonomous QA Agent</h1>
        <p className="text-gray-500">URL과 카테고리를 설정하면 AI가 탐색 → 시나리오 생성 → 실행 → 리포트를 자동으로 수행합니다</p>
      </div>

      <div className="grid grid-cols-3 gap-6 mb-6">
        {/* ── Left: Config ──────────────────────────────────── */}
        <div className="col-span-1 space-y-4">
          {/* Target URLs */}
          <div className="card p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold text-gray-900">대상 URL</h2>
              <button
                onClick={addTarget}
                disabled={isRunning}
                className="text-xs text-blue-600 hover:text-blue-700 border border-blue-200 px-2 py-0.5 rounded hover:bg-blue-50 transition-colors"
              >
                + 추가
              </button>
            </div>
            <div className="space-y-3">
              {targets.map((t) => (
                <AgentTargetCard
                  key={t.id}
                  target={t}
                  disabled={isRunning}
                  onChange={(field, val) => updateTarget(t.id, field, val)}
                  onRemove={targets.length > 1 ? () => removeTarget(t.id) : undefined}
                />
              ))}
            </div>
          </div>

          {/* Max scenarios slider */}
          <div className="card p-5">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-gray-700">최대 시나리오</span>
              <span className="text-sm font-bold text-blue-600">{maxScenarios}개</span>
            </div>
            <input
              type="range" min={5} max={30} value={maxScenarios}
              onChange={(e) => setMaxScenarios(Number(e.target.value))}
              disabled={isRunning}
              className="w-full accent-blue-600"
            />
            <div className="flex justify-between text-xs text-gray-400 mt-1"><span>5</span><span>30</span></div>
          </div>

          {/* Run button */}
          <button
            onClick={run}
            disabled={isRunning || activeCount === 0 || categories.size === 0}
            className="btn-primary w-full"
          >
            {isRunning ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                실행 중...
              </span>
            ) : (
              `▶ 에이전트 시작 (${activeCount}개 URL)`
            )}
          </button>
          {activeCount === 0 && <p className="text-xs text-red-400 text-center">URL을 1개 이상 활성화하세요</p>}
          {categories.size === 0 && <p className="text-xs text-red-400 text-center">카테고리를 1개 이상 선택하세요</p>}
        </div>

        {/* ── Right: Category selector ──────────────────────── */}
        <div className="col-span-2 card p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-900">시나리오 카테고리</h2>
            <div className="flex gap-2">
              <button
                onClick={() => setCategories(new Set(CATEGORIES.map((c) => c.id)))}
                className="text-xs text-blue-600 hover:underline"
              >전체 선택</button>
              <span className="text-gray-300">|</span>
              <button
                onClick={() => setCategories(new Set())}
                className="text-xs text-gray-500 hover:underline"
              >전체 해제</button>
            </div>
          </div>

          <p className="text-xs text-gray-400 mb-4">
            선택한 카테고리 중심으로 AI가 시나리오를 생성합니다. 더 적은 카테고리 = 더 깊은 테스트.
          </p>

          <div className="grid grid-cols-2 gap-3">
            {CATEGORIES.map((cat) => {
              const selected = categories.has(cat.id);
              return (
                <label
                  key={cat.id}
                  className={`flex items-start gap-3 p-4 rounded-xl border cursor-pointer select-none transition-all ${
                    selected ? "border-blue-200 bg-blue-50" : "border-gray-100 hover:border-gray-200 bg-white"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={() => toggleCategory(cat.id)}
                    disabled={isRunning}
                    className="mt-0.5 w-4 h-4 rounded border-gray-300 accent-blue-600"
                  />
                  <div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-base">{cat.emoji}</span>
                      <span className={`text-sm font-semibold ${selected ? "text-blue-700" : "text-gray-700"}`}>
                        {cat.label}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">{cat.desc}</p>
                  </div>
                </label>
              );
            })}
          </div>

          <div className="mt-4 p-3 bg-gray-50 rounded-lg">
            <p className="text-xs text-gray-500">
              선택됨: <span className="font-medium text-gray-700">
                {Array.from(categories).map((c) => CATEGORIES.find((x) => x.id === c)?.label).join(", ") || "없음"}
              </span>
            </p>
          </div>
        </div>
      </div>

      {/* ── Results ─────────────────────────────────────────── */}
      {results.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-xl font-bold text-gray-900">실행 결과</h2>
          {results.map((r, i) => (
            <AgentResultCard key={i} result={r} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Agent Target Card ─────────────────────────────────────────
function AgentTargetCard({
  target, disabled, onChange, onRemove,
}: {
  target: TargetEntry;
  disabled: boolean;
  onChange: <K extends keyof TargetEntry>(field: K, val: TargetEntry[K]) => void;
  onRemove?: () => void;
}) {
  const [showAuth, setShowAuth] = useState(!!target.loginEmail);

  return (
    <div className={`border rounded-lg overflow-hidden ${target.enabled ? "border-gray-200" : "border-gray-100 opacity-60"}`}>
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 bg-gray-50">
        <input
          type="checkbox" checked={target.enabled}
          onChange={(e) => onChange("enabled", e.target.checked)}
          disabled={disabled}
          className="w-4 h-4 rounded border-gray-300 shrink-0"
        />
        <input
          className="flex-1 text-xs font-medium bg-transparent border-none outline-none text-gray-700 min-w-0"
          value={target.label}
          onChange={(e) => onChange("label", e.target.value)}
          disabled={disabled}
          placeholder="레이블"
        />
        <button
          onClick={() => setShowAuth((v) => !v)}
          className={`text-xs shrink-0 px-1.5 py-0.5 rounded border transition-colors ${showAuth ? "border-blue-200 text-blue-600 bg-blue-50" : "border-gray-200 text-gray-400 hover:text-gray-600"}`}
          title="로그인 정보 설정"
        >
          🔑
        </button>
        {onRemove && (
          <button onClick={onRemove} disabled={disabled} className="text-xs text-red-400 hover:text-red-600 shrink-0">✕</button>
        )}
      </div>

      {/* URL */}
      <div className="px-3 py-2">
        <input
          className="input text-sm"
          value={target.url}
          onChange={(e) => onChange("url", e.target.value)}
          disabled={disabled}
          placeholder="https://your-app.com"
        />
      </div>

      {/* Auth */}
      {showAuth && (
        <div className="px-3 pb-3 space-y-2 border-t pt-2">
          <p className="text-xs text-gray-400">로그인 정보 (선택)</p>
          <input
            className="input text-sm" type="email"
            value={target.loginEmail}
            onChange={(e) => onChange("loginEmail", e.target.value)}
            disabled={disabled}
            placeholder="이메일"
          />
          <input
            className="input text-sm" type="password"
            value={target.loginPassword}
            onChange={(e) => onChange("loginPassword", e.target.value)}
            disabled={disabled}
            placeholder="비밀번호"
          />
        </div>
      )}
    </div>
  );
}

// ─── Agent Result Card ─────────────────────────────────────────
function AgentResultCard({ result }: { result: TargetResult }) {
  const { target, events, report, status } = result;
  const [collapsed, setCollapsed] = useState(false);

  const lastEvent = events[events.length - 1];
  const progress = events.reduce((max, e) => Math.max(max, e.progress ?? 0), 0);

  const statusBadge = {
    pending: <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">대기</span>,
    running: (
      <span className="flex items-center gap-1.5 text-xs text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">
        <span className="w-3 h-3 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
        실행 중 {progress > 0 && `${progress}%`}
      </span>
    ),
    done: <span className="text-xs text-green-600 bg-green-50 px-2 py-0.5 rounded-full font-medium">완료</span>,
    error: <span className="text-xs text-red-600 bg-red-50 px-2 py-0.5 rounded-full font-medium">오류</span>,
  }[status];

  return (
    <div className="card overflow-hidden">
      {/* Header */}
      <div
        className="flex items-center justify-between px-5 py-3 bg-gray-50 border-b cursor-pointer"
        onClick={() => setCollapsed((v) => !v)}
      >
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-gray-900">{target.label}</span>
          <a href={target.url} target="_blank" rel="noreferrer" className="text-xs text-blue-400 hover:underline" onClick={(e) => e.stopPropagation()}>
            {target.url.replace("https://", "")}
          </a>
        </div>
        <div className="flex items-center gap-3">
          {report && (
            <>
              <div className="flex gap-2 text-xs">
                <span className="text-green-600 font-medium">{report.passed}P</span>
                <span className="text-red-600 font-medium">{report.failed}F</span>
                {report.errors > 0 && <span className="text-yellow-600 font-medium">{report.errors}E</span>}
              </div>
              <span className="text-xl font-bold text-blue-600">
                {report.score}<span className="text-xs text-gray-400 font-normal">/100</span>
              </span>
            </>
          )}
          {statusBadge}
          <span className="text-gray-400 text-xs">{collapsed ? "▲" : "▼"}</span>
        </div>
      </div>

      {/* Progress bar */}
      {status === "running" && progress > 0 && (
        <div className="h-1 bg-gray-100">
          <div className="h-full bg-blue-500 transition-all duration-500" style={{ width: `${progress}%` }} />
        </div>
      )}

      {!collapsed && (
        <div className="p-5 space-y-4">
          {/* Log */}
          <div>
            <h3 className="text-xs font-semibold text-gray-500 uppercase mb-2">실행 로그</h3>
            <div className="bg-gray-50 rounded-lg p-3 max-h-48 overflow-y-auto space-y-1.5 font-mono text-xs">
              {events.length === 0 ? (
                <span className="text-gray-400">로그 없음</span>
              ) : (
                events.map((e, i) => (
                  <div key={i} className={`flex gap-2 ${e.type === "error" ? "text-red-600" : e.type === "complete" ? "text-green-600" : "text-gray-600"}`}>
                    <span className="text-gray-300 shrink-0 w-5 text-right">{i + 1}</span>
                    <span className="text-blue-500 shrink-0 w-20 uppercase">[{e.stage ?? e.type}]</span>
                    <span className="flex-1">{e.message}</span>
                    {e.progress !== undefined && <span className="text-gray-400 shrink-0">{e.progress}%</span>}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Report */}
          {report && (
            <>
              <div className="grid grid-cols-4 gap-3">
                {[
                  { label: "PASS", value: report.passed, color: "text-green-600", bg: "bg-green-50" },
                  { label: "FAIL", value: report.failed, color: "text-red-600",   bg: "bg-red-50"   },
                  { label: "ERROR", value: report.errors, color: "text-yellow-600", bg: "bg-yellow-50" },
                  { label: "Pass Rate", value: `${report.passRate.toFixed(1)}%`, color: "text-blue-600", bg: "bg-blue-50" },
                ].map((s) => (
                  <div key={s.label} className={`${s.bg} rounded-xl p-3 text-center`}>
                    <div className={`text-xl font-bold ${s.color}`}>{s.value}</div>
                    <div className="text-xs text-gray-500 mt-0.5">{s.label}</div>
                  </div>
                ))}
              </div>

              {report.summary && (
                <p className="text-sm text-gray-600 bg-gray-50 rounded-lg px-4 py-3">{report.summary}</p>
              )}

              <div>
                <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2">시나리오별</h4>
                <div className="space-y-1">
                  {report.scenarios.map((r) => (
                    <div key={r.scenarioId} className="flex items-center gap-2 py-1.5 border-b last:border-0 text-sm">
                      <span className={`text-xs font-bold px-1.5 py-0.5 rounded min-w-[44px] text-center shrink-0 ${
                        r.status === "pass" ? "bg-green-50 text-green-700" :
                        r.status === "fail" ? "bg-red-50 text-red-700" : "bg-yellow-50 text-yellow-700"
                      }`}>{r.status.toUpperCase()}</span>
                      <span className="flex-1 text-gray-700 truncate">{r.scenarioName}</span>
                      <span className="text-xs text-gray-400 shrink-0">{(r.duration / 1000).toFixed(1)}s</span>
                      {r.screenshotPath && (
                        <a href={r.screenshotPath} target="_blank" rel="noreferrer" className="text-xs text-blue-500 hover:underline shrink-0">스크린샷</a>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {report.bugReports.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2">발견된 버그 {report.bugReports.length}건</h4>
                  {report.bugReports.map((bug, i) => (
                    <div key={i} className="p-3 rounded-lg border bg-red-50 border-red-200 text-sm mb-2">
                      <span className="text-xs font-bold text-red-700 mr-1">[{bug.severity}]</span>
                      <span className="font-medium">{bug.title}</span>
                      <p className="text-xs text-gray-600 mt-0.5">{bug.description}</p>
                    </div>
                  ))}
                </div>
              )}

              <div className="text-right">
                <a href={`/reports/${report.runId}.html`} target="_blank" rel="noreferrer" className="text-xs text-blue-500 hover:underline">
                  HTML 리포트 전체 보기 →
                </a>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
