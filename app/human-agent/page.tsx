"use client";

import { useState, useRef, useEffect } from "react";
import type { HumanStep, HumanAgentResult } from "@/lib/human-agent/runner";

// ─── Types ─────────────────────────────────────────────────────
interface RunState {
  running: boolean;
  steps: HumanStep[];
  result: HumanAgentResult | null;
  error: string | null;
}

const ACTION_COLORS: Record<string, string> = {
  click:    "bg-blue-100 text-blue-700",
  fill:     "bg-purple-100 text-purple-700",
  navigate: "bg-gray-100 text-gray-600",
  wait:     "bg-yellow-100 text-yellow-700",
  scroll:   "bg-cyan-100 text-cyan-700",
  press:    "bg-orange-100 text-orange-700",
  done:     "bg-green-100 text-green-700",
  fail:     "bg-red-100 text-red-700",
};

const ACTION_ICONS: Record<string, string> = {
  click: "👆", fill: "✏️", navigate: "🌐", wait: "⏳",
  scroll: "📜", press: "⌨️", done: "✅", fail: "❌",
};

// ─── Page ──────────────────────────────────────────────────────
export default function HumanAgentPage() {
  const [targetUrl, setTargetUrl]       = useState("https://d22ekkgk95jcrg.cloudfront.net/demo/index.html");
  const [goal, setGoal]                 = useState("채팅 위젯을 열고 '안녕하세요' 메시지를 보낸 후 응답을 확인해줘");
  const [loginEmail, setLoginEmail]     = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [maxSteps, setMaxSteps]         = useState(20);
  const [showAuth, setShowAuth]         = useState(false);
  const [state, setState]               = useState<RunState>({ running: false, steps: [], result: null, error: null });
  const [expandedStep, setExpandedStep] = useState<number | null>(null);
  const bottomRef                       = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (state.running) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [state.steps.length, state.running]);

  const start = async () => {
    if (state.running || !targetUrl.trim() || !goal.trim()) return;
    setState({ running: true, steps: [], result: null, error: null });

    try {
      const res = await fetch("/api/human-agent/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetUrl: targetUrl.trim(),
          goal: goal.trim(),
          loginEmail: loginEmail.trim() || undefined,
          loginPassword: loginPassword.trim() || undefined,
          maxSteps,
        }),
      });

      if (!res.body) throw new Error("No response body");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const evt = JSON.parse(line.slice(6));
            if (evt.type === "step") {
              setState((s) => ({ ...s, steps: [...s.steps, evt.step] }));
            } else if (evt.type === "complete") {
              setState((s) => ({ ...s, running: false, result: evt.result }));
            } else if (evt.type === "error") {
              setState((s) => ({ ...s, running: false, error: evt.message }));
            }
          } catch { /* ignore parse errors */ }
        }
      }
    } catch (err) {
      setState((s) => ({ ...s, running: false, error: String(err) }));
    }
  };

  const { running, steps, result, error } = state;
  const statusColor = result?.status === "done" ? "text-green-600" : result?.status === "fail" ? "text-red-600" : "text-yellow-600";
  const statusLabel = result?.status === "done" ? "✅ 완료" : result?.status === "fail" ? "❌ 버그 발견" : "⏱ 최대 스텝 도달";

  return (
    <div className="flex h-[calc(100vh-56px)]">
      {/* ── Left Panel: Config ──────────────────────────────── */}
      <div className="w-80 shrink-0 border-r bg-gray-50 flex flex-col">
        <div className="p-4 border-b bg-white">
          <h2 className="font-semibold text-gray-800 text-sm">Human-mode Agent</h2>
          <p className="text-xs text-gray-500 mt-0.5">GPT-4o Vision이 화면을 보고 사람처럼 테스트</p>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* URL */}
          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">테스트 URL</label>
            <input
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 outline-none focus:border-blue-400 bg-white"
              value={targetUrl} onChange={(e) => setTargetUrl(e.target.value)}
              placeholder="https://your-app.com" disabled={running}
            />
          </div>

          {/* Goal */}
          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">테스트 목표</label>
            <textarea
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 outline-none focus:border-blue-400 bg-white resize-none"
              rows={4} value={goal} onChange={(e) => setGoal(e.target.value)}
              placeholder="예: 채팅 위젯을 열고 메시지를 보낸 후 응답을 확인해줘" disabled={running}
            />
            <p className="text-xs text-gray-400 mt-1">자연어로 자유롭게 작성하세요</p>
          </div>

          {/* Max Steps */}
          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">최대 스텝 수: {maxSteps}</label>
            <input
              type="range" min={5} max={30} step={5} value={maxSteps}
              onChange={(e) => setMaxSteps(Number(e.target.value))}
              className="w-full accent-blue-500" disabled={running}
            />
            <div className="flex justify-between text-xs text-gray-400 mt-0.5">
              <span>5</span><span>30</span>
            </div>
          </div>

          {/* Auth */}
          <div>
            <button
              onClick={() => setShowAuth((v) => !v)}
              className="text-xs text-gray-500 hover:text-blue-600 flex items-center gap-1"
              disabled={running}
            >
              🔑 로그인 정보 {showAuth ? "숨기기" : "추가 (선택)"}
            </button>
            {showAuth && (
              <div className="mt-2 space-y-2">
                <input
                  type="email" className="w-full text-xs border border-gray-200 rounded px-2 py-1.5 outline-none focus:border-blue-300 bg-white"
                  value={loginEmail} onChange={(e) => setLoginEmail(e.target.value)}
                  placeholder="이메일" disabled={running}
                />
                <input
                  type="password" className="w-full text-xs border border-gray-200 rounded px-2 py-1.5 outline-none focus:border-blue-300 bg-white"
                  value={loginPassword} onChange={(e) => setLoginPassword(e.target.value)}
                  placeholder="비밀번호" disabled={running}
                />
              </div>
            )}
          </div>
        </div>

        <div className="p-4 border-t">
          <button
            onClick={start}
            disabled={running || !targetUrl.trim() || !goal.trim()}
            className="w-full py-2.5 rounded-lg text-sm font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed bg-blue-600 hover:bg-blue-700 text-white"
          >
            {running ? "실행 중..." : "▶ 테스트 시작"}
          </button>
        </div>
      </div>

      {/* ── Right Panel: Live Steps ──────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-6 py-3 border-b bg-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-gray-700">실행 로그</span>
            {running && (
              <span className="flex items-center gap-1.5 text-xs text-blue-600">
                <span className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
                GPT-4o Vision이 화면을 보고 판단 중...
              </span>
            )}
            {result && (
              <span className={`text-sm font-semibold ${statusColor}`}>{statusLabel}</span>
            )}
          </div>
          {steps.length > 0 && (
            <span className="text-xs text-gray-400">{steps.length} 스텝 완료</span>
          )}
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* Empty state */}
          {steps.length === 0 && !running && !error && (
            <div className="flex flex-col items-center justify-center h-full text-gray-400 gap-3">
              <div className="text-5xl">🤖</div>
              <p className="text-sm">목표를 입력하고 테스트를 시작하세요</p>
              <p className="text-xs text-gray-300">GPT-4o가 화면을 보며 사람처럼 테스트합니다</p>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="m-6 p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              <strong>오류:</strong> {error}
            </div>
          )}

          {/* Steps */}
          <div className="divide-y">
            {steps.map((step) => (
              <StepCard
                key={step.stepNumber}
                step={step}
                expanded={expandedStep === step.stepNumber}
                onToggle={() => setExpandedStep(expandedStep === step.stepNumber ? null : step.stepNumber)}
              />
            ))}
          </div>

          {/* Running indicator */}
          {running && (
            <div className="p-4 flex items-center gap-3 text-sm text-gray-500">
              <span className="w-5 h-5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin shrink-0" />
              스크린샷 분석 중...
            </div>
          )}

          {/* Result summary */}
          {result && (
            <div className={`m-6 p-4 rounded-lg border text-sm ${
              result.status === "done" ? "bg-green-50 border-green-200 text-green-800" :
              result.status === "fail" ? "bg-red-50 border-red-200 text-red-800" :
              "bg-yellow-50 border-yellow-200 text-yellow-800"
            }`}>
              <div className="font-semibold mb-1">{statusLabel}</div>
              <div className="text-sm">{result.summary}</div>
              <div className="text-xs mt-2 opacity-70">
                총 {result.steps.length} 스텝 · {(result.totalDurationMs / 1000).toFixed(1)}초
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </div>
    </div>
  );
}

// ─── Step Card ──────────────────────────────────────────────────
function StepCard({ step, expanded, onToggle }: {
  step: HumanStep;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { decision, success, error, screenshotPath, stepNumber, durationMs } = step;
  const colorClass = ACTION_COLORS[decision.action] ?? "bg-gray-100 text-gray-600";
  const icon = ACTION_ICONS[decision.action] ?? "•";

  return (
    <div className={`${!success ? "bg-red-50" : ""}`}>
      <button
        onClick={onToggle}
        className="w-full px-6 py-3 flex items-start gap-3 hover:bg-gray-50 transition-colors text-left"
      >
        {/* Step number */}
        <span className="w-6 h-6 rounded-full bg-gray-200 text-gray-600 text-xs flex items-center justify-center shrink-0 mt-0.5 font-medium">
          {stepNumber}
        </span>

        {/* Action badge */}
        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full shrink-0 mt-0.5 ${colorClass}`}>
          {icon} {decision.action}
        </span>

        {/* Description */}
        <div className="flex-1 min-w-0">
          <p className="text-sm text-gray-800 leading-snug">{decision.description}</p>
          {error && (
            <p className="text-xs text-red-500 mt-0.5">⚠ {error}</p>
          )}
        </div>

        {/* Duration + expand */}
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs text-gray-400">{(durationMs / 1000).toFixed(1)}s</span>
          <svg className={`w-4 h-4 text-gray-400 transition-transform ${expanded ? "rotate-180" : ""}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {/* Expanded: observation + screenshot */}
      {expanded && (
        <div className="px-6 pb-4 space-y-3 bg-gray-50 border-t">
          {/* Observation */}
          <div className="pt-3">
            <p className="text-xs font-medium text-gray-500 mb-1">👁 AI 관찰</p>
            <p className="text-xs text-gray-600 bg-white rounded px-3 py-2 border">{decision.observation}</p>
          </div>

          {/* Target/Value */}
          {(decision.target || decision.value) && (
            <div className="flex gap-4 text-xs">
              {decision.target && (
                <div>
                  <span className="text-gray-400">target: </span>
                  <code className="bg-white border rounded px-1.5 py-0.5 text-gray-700">{decision.target}</code>
                </div>
              )}
              {decision.value && (
                <div>
                  <span className="text-gray-400">value: </span>
                  <code className="bg-white border rounded px-1.5 py-0.5 text-gray-700">{decision.value}</code>
                </div>
              )}
            </div>
          )}

          {/* Screenshot */}
          {screenshotPath && (
            <div>
              <p className="text-xs font-medium text-gray-500 mb-1">📸 스크린샷</p>
              <a href={screenshotPath} target="_blank" rel="noopener noreferrer">
                <img
                  src={screenshotPath} alt={`Step ${stepNumber}`}
                  className="rounded border max-h-64 object-top object-cover w-full cursor-pointer hover:opacity-90 transition-opacity"
                />
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
