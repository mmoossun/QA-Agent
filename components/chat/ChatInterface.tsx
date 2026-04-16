"use client";

import { useState, useRef, useEffect } from "react";
import type { QAScenario, TestResult, StepResult } from "@/lib/ai/types";

// ─── Types ────────────────────────────────────────────────────
interface TargetEntry {
  id: string; label: string; url: string;
  loginEmail: string; loginPassword: string; enabled: boolean;
}

type LoadingStage = "analyzing" | "generating" | "running" | null;

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  scenarios?: QAScenario[];
  results?: Record<string, TestResult[]>;
  timestamp: Date;
}

const DEFAULT_TARGETS: TargetEntry[] = [
  { id: "t1", label: "대시보드 (상담원용)", url: "https://app-dev.generativelab.co.kr", loginEmail: "qa-owner@example.com", loginPassword: "TestPassword123", enabled: true },
  { id: "t2", label: "위젯 데모 (고객 채팅)", url: "https://d22ekkgk95jcrg.cloudfront.net/demo/index.html", loginEmail: "", loginPassword: "", enabled: true },
];

// ─── Main Component ───────────────────────────────────────────
export function ChatInterface() {
  const [messages, setMessages] = useState<Message[]>([{
    id: "welcome", role: "assistant", timestamp: new Date(),
    content: "안녕하세요! 테스트하고 싶은 기능을 자연어로 입력해주세요.\n예: \"로그인 기능을 정상/비정상 케이스로 테스트해줘\"\n예: \"채팅 위젯 열기 및 메시지 전송 테스트\"",
  }]);
  const [input, setInput]           = useState("");
  const [executeNow, setExecuteNow] = useState(false);
  const [headless, setHeadless]     = useState(true);
  const [targets, setTargets]       = useState<TargetEntry[]>(DEFAULT_TARGETS);
  const [panelOpen, setPanelOpen]   = useState(false);
  const [loadingStage, setLoadingStage] = useState<LoadingStage>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const addTarget = () =>
    setTargets(p => [...p, { id: `t${Date.now()}`, label: `URL ${p.length + 1}`, url: "", loginEmail: "", loginPassword: "", enabled: true }]);
  const removeTarget = (id: string) => setTargets(p => p.filter(t => t.id !== id));
  const updateTarget = <K extends keyof TargetEntry>(id: string, field: K, value: TargetEntry[K]) =>
    setTargets(p => p.map(t => t.id === id ? { ...t, [field]: value } : t));

  const sendMessage = async () => {
    if (!input.trim() || loadingStage) return;
    const text = input;
    const userMsg: Message = { id: crypto.randomUUID(), role: "user", content: text, timestamp: new Date() };
    setMessages(p => [...p, userMsg]);
    setInput("");

    try {
      const activeTargets = targets.filter(t => t.enabled && t.url.trim());
      const history = messages.filter(m => m.id !== "welcome").map(m => ({ role: m.role, content: m.content }));

      // Stage 1: Analyze URL + generate scenarios
      setLoadingStage("analyzing");
      await new Promise(r => setTimeout(r, 600)); // let UI update
      setLoadingStage("generating");

      const res = await fetch("/api/chat", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text, history,
          executeNow: false,
          targetUrl: activeTargets[0]?.url,
          loginEmail: activeTargets[0]?.loginEmail || undefined,
          loginPassword: activeTargets[0]?.loginPassword || undefined,
        }),
      });
      const data = await res.json();
      const scenarios: QAScenario[] = data.scenarios ?? [];

      // Stage 2: Execute if requested
      let allResults: Record<string, TestResult[]> = {};
      if (executeNow && scenarios.length > 0 && activeTargets.length > 0) {
        setLoadingStage("running");
        for (const target of activeTargets) {
          const runRes = await fetch("/api/qa/run", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              scenarios, targetUrl: target.url,
              loginEmail: target.loginEmail || undefined,
              loginPassword: target.loginPassword || undefined,
              options: { headless, maxRetries: 0 },
            }),
          });
          const runData = await runRes.json();
          if (runData.success && runData.report?.scenarios) {
            allResults[target.id] = runData.report.scenarios;
          }
        }
      }

      setMessages(p => [...p, {
        id: crypto.randomUUID(), role: "assistant", timestamp: new Date(),
        content: data.message ?? `시나리오 ${scenarios.length}개가 생성되었습니다.`,
        scenarios,
        results: Object.keys(allResults).length > 0 ? allResults : undefined,
      }]);
    } catch (err) {
      setMessages(p => [...p, { id: crypto.randomUUID(), role: "assistant", content: `오류: ${err}`, timestamp: new Date() }]);
    } finally {
      setLoadingStage(null);
    }
  };

  const enabledCount = targets.filter(t => t.enabled && t.url.trim()).length;
  const loading = loadingStage !== null;

  return (
    <div className="flex h-full">
      {/* ── URL Panel ───────────────────────────────────────── */}
      <div className={`flex-shrink-0 border-r bg-gray-50 transition-all duration-200 ${panelOpen ? "w-72" : "w-10"} flex flex-col`}>
        <button onClick={() => setPanelOpen(v => !v)}
          className="h-10 flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors border-b shrink-0"
          title={panelOpen ? "패널 닫기" : "URL 설정 열기"}>
          {panelOpen ? "◀" : "⚙"}
        </button>
        {panelOpen && (
          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">대상 URL</span>
              <button onClick={addTarget} className="text-xs text-blue-600 hover:text-blue-700 border border-blue-200 px-2 py-0.5 rounded hover:bg-blue-50">+ 추가</button>
            </div>
            {targets.map(t => (
              <TargetCard key={t.id} target={t}
                onChange={(field, value) => updateTarget(t.id, field, value)}
                onRemove={targets.length > 1 ? () => removeTarget(t.id) : undefined} />
            ))}
            <div className="border-t pt-3 space-y-2">
              <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer select-none">
                <input type="checkbox" checked={executeNow} onChange={e => setExecuteNow(e.target.checked)} className="w-3.5 h-3.5 rounded" />
                생성 후 바로 실행
              </label>
              {executeNow && (
                <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer select-none">
                  <input type="checkbox" checked={headless} onChange={e => setHeadless(e.target.checked)} className="w-3.5 h-3.5 rounded" />
                  Headless 모드
                </label>
              )}
              {executeNow && enabledCount > 0 && (
                <p className="text-xs text-blue-600 bg-blue-50 rounded px-2 py-1">{enabledCount}개 URL에 순차 실행</p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Chat ────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0">
        {!panelOpen && enabledCount > 0 && (
          <div className="px-4 py-2 bg-blue-50 border-b flex items-center gap-2 cursor-pointer hover:bg-blue-100 transition-colors" onClick={() => setPanelOpen(true)}>
            <span className="text-xs text-blue-600 font-medium">{enabledCount}개 URL 설정됨</span>
            {executeNow && <span className="text-xs text-green-600">· 바로 실행 ON</span>}
            <span className="text-xs text-blue-400 ml-auto">설정 열기 ▶</span>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {messages.map(msg => <MessageBubble key={msg.id} message={msg} targets={targets} />)}

          {loading && (
            <div className="flex gap-3">
              <div className="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center text-white text-xs shrink-0">AI</div>
              <div className="card px-4 py-3 space-y-2">
                <LoadingIndicator stage={loadingStage} />
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        <div className="p-4 border-t bg-white">
          <div className="flex gap-3">
            <textarea className="input flex-1 resize-none text-sm" rows={2}
              placeholder='예: "로그인/로그아웃 기능을 정상 + 실패 케이스로 테스트해줘"'
              value={input} onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }} />
            <button onClick={sendMessage} disabled={!input.trim() || loading} className="btn-primary self-end">전송</button>
          </div>
          <p className="text-xs text-gray-400 mt-1.5">Enter로 전송 | Shift+Enter 줄바꿈</p>
        </div>
      </div>
    </div>
  );
}

// ─── Loading Indicator ─────────────────────────────────────────
function LoadingIndicator({ stage }: { stage: LoadingStage }) {
  const stages: { key: LoadingStage; label: string; icon: string }[] = [
    { key: "analyzing",  label: "URL 분석 중 (페이지 스냅샷 수집)...", icon: "🔍" },
    { key: "generating", label: "시나리오 생성 중...",                  icon: "🤖" },
    { key: "running",    label: "Playwright로 실행 중...",               icon: "▶" },
  ];
  return (
    <div className="space-y-1.5">
      {stages.map(s => {
        const stageOrder = ["analyzing", "generating", "running"];
        const currentIdx = stageOrder.indexOf(stage ?? "");
        const thisIdx = stageOrder.indexOf(s.key ?? "");
        const isDone = thisIdx < currentIdx;
        const isActive = s.key === stage;
        return (
          <div key={s.key} className={`flex items-center gap-2 text-sm transition-opacity ${isActive ? "opacity-100" : isDone ? "opacity-40" : "opacity-20"}`}>
            <span>{isDone ? "✅" : isActive ? <span className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin inline-block" /> : s.icon}</span>
            <span className={isActive ? "text-gray-700 font-medium" : "text-gray-400"}>{s.label}</span>
          </div>
        );
      })}
    </div>
  );
}

// ─── Target Card ───────────────────────────────────────────────
function TargetCard({ target, onChange, onRemove }: {
  target: TargetEntry;
  onChange: <K extends keyof TargetEntry>(field: K, value: TargetEntry[K]) => void;
  onRemove?: () => void;
}) {
  const [showAuth, setShowAuth] = useState(!!target.loginEmail);
  return (
    <div className={`rounded-lg border overflow-hidden ${target.enabled ? "border-blue-200" : "border-gray-200 opacity-60"}`}>
      <div className="flex items-center gap-1.5 px-2 py-1.5 bg-white">
        <input type="checkbox" checked={target.enabled} onChange={e => onChange("enabled", e.target.checked)} className="w-3.5 h-3.5 rounded shrink-0" />
        <input className="flex-1 text-xs font-medium bg-transparent border-none outline-none text-gray-700 min-w-0"
          value={target.label} onChange={e => onChange("label", e.target.value)} placeholder="레이블" />
        <button onClick={() => setShowAuth(v => !v)} className="text-xs text-gray-400 hover:text-gray-600 shrink-0" title="로그인 정보">🔑</button>
        {onRemove && <button onClick={onRemove} className="text-xs text-red-400 hover:text-red-600 shrink-0">✕</button>}
      </div>
      <div className="px-2 pb-1.5">
        <input className="w-full text-xs border border-gray-200 rounded px-2 py-1 bg-white outline-none focus:border-blue-300"
          value={target.url} onChange={e => onChange("url", e.target.value)} placeholder="https://your-app.com" />
      </div>
      {showAuth && (
        <div className="px-2 pb-2 space-y-1 bg-gray-50 border-t">
          <input className="w-full text-xs border border-gray-200 rounded px-2 py-1 bg-white outline-none focus:border-blue-300 mt-1.5"
            type="email" value={target.loginEmail} onChange={e => onChange("loginEmail", e.target.value)} placeholder="이메일 (선택)" />
          <input className="w-full text-xs border border-gray-200 rounded px-2 py-1 bg-white outline-none focus:border-blue-300"
            type="password" value={target.loginPassword} onChange={e => onChange("loginPassword", e.target.value)} placeholder="비밀번호 (선택)" />
        </div>
      )}
    </div>
  );
}

// ─── Message Bubble ────────────────────────────────────────────
function MessageBubble({ message, targets }: { message: Message; targets: TargetEntry[] }) {
  const isUser = message.role === "user";
  return (
    <div className={`flex gap-3 ${isUser ? "flex-row-reverse" : ""}`}>
      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium shrink-0 ${isUser ? "bg-gray-200 text-gray-600" : "bg-blue-600 text-white"}`}>
        {isUser ? "You" : "AI"}
      </div>
      <div className={`max-w-[85%] space-y-3 ${isUser ? "items-end" : ""}`}>
        <div className={`px-4 py-3 rounded-xl text-sm whitespace-pre-wrap ${isUser ? "bg-blue-600 text-white ml-auto" : "card text-gray-700"}`}>
          {message.content}
        </div>
        {message.scenarios && message.scenarios.length > 0 && (
          <ScenarioList scenarios={message.scenarios} results={message.results} targets={targets} />
        )}
      </div>
    </div>
  );
}

// ─── Scenario List ─────────────────────────────────────────────
function ScenarioList({ scenarios, results, targets }: {
  scenarios: QAScenario[];
  results?: Record<string, TestResult[]>;
  targets: TargetEntry[];
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const hasResults = results && Object.keys(results).length > 0;
  const enabledTargetsWithResults = targets.filter(t => results?.[t.id]);
  const [activeTab, setActiveTab] = useState(enabledTargetsWithResults[0]?.id ?? "");
  const activeResults = activeTab ? results?.[activeTab] : undefined;

  // Summary stats
  const passCount = activeResults?.filter(r => r.status === "pass").length ?? 0;
  const failCount = activeResults?.filter(r => r.status !== "pass").length ?? 0;
  const totalMs = activeResults?.reduce((s, r) => s + r.duration, 0) ?? 0;

  return (
    <div className="card overflow-hidden w-full">
      {/* Header */}
      <div className="px-4 py-2.5 bg-gray-50 border-b flex items-center justify-between">
        <span className="text-xs font-medium text-gray-500">시나리오 {scenarios.length}개</span>
        {hasResults && activeResults && (
          <div className="flex items-center gap-3 text-xs">
            <span className="text-green-600 font-medium">✓ {passCount}개 통과</span>
            {failCount > 0 && <span className="text-red-500 font-medium">✗ {failCount}개 실패</span>}
            <span className="text-gray-400">{(totalMs / 1000).toFixed(1)}s</span>
          </div>
        )}
      </div>

      {/* Tabs for multiple URLs */}
      {hasResults && enabledTargetsWithResults.length > 1 && (
        <div className="flex border-b overflow-x-auto">
          {enabledTargetsWithResults.map(t => {
            const res = results![t.id];
            const pass = res.filter(r => r.status === "pass").length;
            return (
              <button key={t.id} onClick={() => setActiveTab(t.id)}
                className={`px-3 py-1.5 text-xs whitespace-nowrap border-b-2 transition-colors flex items-center gap-1.5 ${activeTab === t.id ? "border-blue-500 text-blue-600 bg-blue-50" : "border-transparent text-gray-500 hover:text-gray-700"}`}>
                <span className="truncate max-w-[120px]">{t.label}</span>
                <span className={`font-medium ${pass === res.length ? "text-green-600" : "text-red-500"}`}>{pass}/{res.length}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Scenario rows */}
      <div className="divide-y">
        {scenarios.map(s => {
          const result = activeResults?.find(r => r.scenarioId === s.id);
          const isExpanded = expanded === s.id;
          const statusColor = !result ? "" : result.status === "pass" ? "bg-green-50 text-green-700" : result.status === "fail" ? "bg-red-50 text-red-700" : "bg-yellow-50 text-yellow-700";
          return (
            <div key={s.id}>
              <button className="w-full px-4 py-3 text-left flex items-center gap-3 hover:bg-gray-50 transition-colors"
                onClick={() => setExpanded(isExpanded ? null : s.id)}>
                <span className={`w-2 h-2 rounded-full shrink-0 ${s.priority === "critical" ? "bg-red-500" : s.priority === "high" ? "bg-orange-400" : "bg-blue-400"}`} />
                <span className="text-sm font-medium flex-1 text-left truncate">{s.name}</span>
                {result && (
                  <span className={`text-xs font-bold px-1.5 py-0.5 rounded shrink-0 ${statusColor}`}>
                    {result.status.toUpperCase()} {result.duration ? `${(result.duration / 1000).toFixed(1)}s` : ""}
                  </span>
                )}
                <span className="text-gray-400 text-xs shrink-0">{s.steps.length} steps</span>
                <svg className={`w-4 h-4 text-gray-400 transition-transform shrink-0 ${isExpanded ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {isExpanded && (
                <div className="bg-gray-50 border-t">
                  {/* Step-level results */}
                  {result?.steps && result.steps.length > 0 ? (
                    <div className="divide-y divide-gray-100">
                      {result.steps.map((sr, i) => <StepRow key={i} stepResult={sr} index={i} />)}
                    </div>
                  ) : (
                    /* No execution yet — show step descriptions */
                    <div className="px-4 py-3 text-xs text-gray-500 space-y-2">
                      <div><span className="font-medium text-gray-600">Category:</span> {s.category} · <span className="font-medium text-gray-600">Priority:</span> {s.priority}</div>
                      <ol className="space-y-1 list-decimal list-inside">
                        {s.steps.map((step, i) => (
                          <li key={i} className="text-gray-600">
                            {step.description}
                            {step.frame && <span className="ml-1 text-purple-500 text-[10px] bg-purple-50 px-1 rounded">frame</span>}
                          </li>
                        ))}
                      </ol>
                      <div className="text-gray-500"><span className="font-medium text-gray-600">Expected:</span> {s.expectedResult}</div>
                    </div>
                  )}

                  {/* Scenario-level error */}
                  {result?.errorMessage && !result.steps?.find(s => s.error) && (
                    <div className="mx-4 mb-3 bg-red-50 border border-red-200 rounded p-2.5 text-xs text-red-700 font-mono">
                      {result.errorMessage}
                    </div>
                  )}

                  {/* Screenshot */}
                  {result?.screenshotPath && (
                    <div className="px-4 pb-3">
                      <a href={result.screenshotPath} target="_blank" rel="noreferrer">
                        <img src={result.screenshotPath} alt="screenshot" className="rounded border max-h-48 object-cover hover:max-h-none transition-all cursor-zoom-in" />
                      </a>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Step Row ──────────────────────────────────────────────────
function StepRow({ stepResult, index }: { stepResult: StepResult; index: number }) {
  const [showError, setShowError] = useState(false);
  const { step, status, duration, error, screenshotPath } = stepResult;
  const isFail = status === "fail";

  return (
    <div className={`px-4 py-2 text-xs flex items-start gap-2 ${isFail ? "bg-red-50" : ""}`}>
      <span className={`shrink-0 w-4 h-4 rounded-full flex items-center justify-center text-white text-[9px] font-bold mt-0.5 ${isFail ? "bg-red-500" : "bg-green-500"}`}>
        {isFail ? "✗" : "✓"}
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="font-mono text-gray-400 text-[10px] shrink-0">{String(index + 1).padStart(2, "0")}</span>
          <span className={`px-1 py-0.5 rounded text-[10px] font-medium shrink-0 ${
            step.action === "navigate" ? "bg-blue-100 text-blue-700" :
            step.action === "click"    ? "bg-orange-100 text-orange-700" :
            step.action === "fill"     ? "bg-green-100 text-green-700" :
            step.action === "assert"   ? "bg-purple-100 text-purple-700" :
            step.action === "evaluate" ? "bg-gray-200 text-gray-700" :
            "bg-gray-100 text-gray-600"
          }`}>{step.action}</span>
          {step.frame && <span className="px-1 py-0.5 rounded text-[10px] bg-purple-50 text-purple-600 shrink-0">iframe</span>}
          <span className="text-gray-600 truncate">{step.description}</span>
          <span className="text-gray-400 shrink-0 ml-auto">{duration}ms</span>
        </div>

        {isFail && error && (
          <div className="mt-1">
            <button onClick={() => setShowError(v => !v)} className="text-red-500 hover:text-red-700 text-[10px] underline">
              {showError ? "에러 숨기기" : "에러 보기"}
            </button>
            {showError && (
              <div className="mt-1 bg-red-50 border border-red-200 rounded p-1.5 font-mono text-[10px] text-red-700 break-all">
                {error}
              </div>
            )}
          </div>
        )}

        {screenshotPath && (
          <div className="mt-1.5">
            <a href={screenshotPath} target="_blank" rel="noreferrer">
              <img src={screenshotPath} alt="step screenshot" className="rounded border max-h-32 object-cover hover:max-h-80 transition-all cursor-zoom-in" />
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
