"use client";

import { useRef, useState } from "react";
import * as XLSX from "xlsx";
import type { HumanStep, HumanAgentResult } from "@/lib/human-agent/runner";

// ─── Types ─────────────────────────────────────────────────────
interface TargetEntry {
  id: string; label: string; url: string;
  loginEmail: string; loginPassword: string; enabled: boolean;
}

type Category = "auth" | "form" | "ui" | "navigation" | "security" | "api" | "performance";
const CATEGORIES: { id: Category; label: string; emoji: string }[] = [
  { id: "auth",        label: "인증",      emoji: "🔐" },
  { id: "form",        label: "폼",        emoji: "📝" },
  { id: "ui",          label: "UI",        emoji: "🎨" },
  { id: "navigation",  label: "네비게이션", emoji: "🗺️" },
  { id: "security",    label: "보안",      emoji: "🛡️" },
  { id: "api",         label: "API",       emoji: "⚡" },
  { id: "performance", label: "성능",      emoji: "📈" },
];

interface ParsedSheet { rawTable?: string; fileName: string; rowCount: number; }

interface TargetRun {
  target: TargetEntry;
  steps: HumanStep[];
  result: HumanAgentResult | null;
  status: "pending" | "running" | "done" | "fail" | "max_steps" | "error";
  error?: string;
}

const DEFAULT_TARGETS: TargetEntry[] = [
  { id: "t1", label: "대시보드 (상담원용)",   url: "https://app-dev.generativelab.co.kr",                   loginEmail: "qa-owner@example.com", loginPassword: "TestPassword123", enabled: true },
  { id: "t2", label: "위젯 데모 (고객 채팅)", url: "https://d22ekkgk95jcrg.cloudfront.net/demo/index.html", loginEmail: "",                    loginPassword: "",               enabled: false },
];

const ACTION_COLORS: Record<string, string> = {
  click: "bg-blue-100 text-blue-700", fill: "bg-purple-100 text-purple-700",
  navigate: "bg-gray-100 text-gray-600", wait: "bg-yellow-100 text-yellow-700",
  scroll: "bg-cyan-100 text-cyan-700", press: "bg-orange-100 text-orange-700",
  done: "bg-green-100 text-green-700", fail: "bg-red-100 text-red-700",
};
const ACTION_ICONS: Record<string, string> = {
  click: "👆", fill: "✏️", navigate: "🌐", wait: "⏳",
  scroll: "📜", press: "⌨️", done: "✅", fail: "❌",
};

// ─── File parsing (reused from Auto Agent) ────────────────────
function parseCSVLine(line: string, sep = ","): string[] {
  const res: string[] = []; let cur = ""; let inQ = false;
  for (const ch of line) {
    if (ch === '"') inQ = !inQ;
    else if (ch === sep && !inQ) { res.push(cur.trim()); cur = ""; }
    else cur += ch;
  }
  res.push(cur.trim()); return res;
}
async function parseSheet(file: File): Promise<ParsedSheet & { error?: string }> {
  if (file.name.endsWith(".xlsx") || file.name.endsWith(".xls")) {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    const rows = XLSX.utils.sheet_to_json<Record<string, string>>(wb.Sheets[wb.SheetNames[0]], { defval: "" });
    if (!rows.length) return { fileName: file.name, rowCount: 0, error: "빈 파일" };
    const headers = Object.keys(rows[0]);
    const rawTable = [`| ${headers.join(" | ")} |`, `| ${headers.map(() => "---").join(" | ")} |`,
      ...rows.slice(0, 100).map(r => `| ${headers.map(h => String(r[h] ?? "").replace(/\|/g, "｜")).join(" | ")} |`)
    ].join("\n");
    return { rawTable, fileName: file.name, rowCount: rows.length };
  }
  const text = await file.text();
  if (file.name.endsWith(".json")) {
    try {
      const rows = (Array.isArray(JSON.parse(text)) ? JSON.parse(text) : [JSON.parse(text)]) as Record<string, unknown>[];
      const headers = Array.from(new Set(rows.flatMap(r => Object.keys(r))));
      const rawTable = [`| ${headers.join(" | ")} |`, `| ${headers.map(() => "---").join(" | ")} |`,
        ...rows.slice(0, 100).map(r => `| ${headers.map(h => String(r[h] ?? "").replace(/\|/g, "｜")).join(" | ")} |`)
      ].join("\n");
      return { rawTable, fileName: file.name, rowCount: rows.length };
    } catch (e) { return { fileName: file.name, rowCount: 0, error: `JSON 오류: ${e}` }; }
  }
  if (file.name.endsWith(".csv") || file.name.endsWith(".tsv")) {
    const sep = file.name.endsWith(".tsv") ? "\t" : ",";
    const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
    if (lines.length < 2) return { fileName: file.name, rowCount: 0, error: "빈 파일" };
    const headers = parseCSVLine(lines[0], sep).map(h => h.replace(/"/g, "").trim());
    const rawTable = [`| ${headers.join(" | ")} |`, `| ${headers.map(() => "---").join(" | ")} |`,
      ...lines.slice(1, 101).map(l => `| ${parseCSVLine(l, sep).map(c => c.replace(/"/g, "").replace(/\|/g, "｜").trim()).join(" | ")} |`)
    ].join("\n");
    return { rawTable, fileName: file.name, rowCount: lines.length - 1 };
  }
  return { fileName: file.name, rowCount: 0, error: "지원 형식: xlsx · csv · tsv · json" };
}

// ─── Page ──────────────────────────────────────────────────────
export default function HumanAgentPage() {
  const [targets, setTargets]           = useState<TargetEntry[]>(DEFAULT_TARGETS);
  const [goal, setGoal]                 = useState("채팅 위젯을 열고 '안녕하세요' 메시지를 보낸 후 응답을 확인해줘");
  const [maxSteps, setMaxSteps]         = useState(20);
  const [categories, setCategories]     = useState<Set<Category>>(new Set(CATEGORIES.map(c => c.id)));
  const [customPrompt, setCustomPrompt] = useState("");
  const [sheet, setSheet]               = useState<ParsedSheet | null>(null);
  const [fileError, setFileError]       = useState<string | null>(null);
  const [panelOpen, setPanelOpen]       = useState(true);
  const fileRef                         = useRef<HTMLInputElement>(null);

  const [runs, setRuns]                 = useState<TargetRun[]>([]);
  const [running, setRunning]           = useState(false);
  const [activeTab, setActiveTab]       = useState<string>("");
  const [expandedStep, setExpandedStep] = useState<number | null>(null);
  const bottomRef                       = useRef<HTMLDivElement>(null);

  // ── Target helpers ─────────────────────────────────────────
  const addTarget = () => setTargets(p => [...p, { id: `t${Date.now()}`, label: `URL ${p.length + 1}`, url: "", loginEmail: "", loginPassword: "", enabled: true }]);
  const removeTarget = (id: string) => setTargets(p => p.filter(t => t.id !== id));
  const updateTarget = <K extends keyof TargetEntry>(id: string, f: K, v: TargetEntry[K]) =>
    setTargets(p => p.map(t => t.id === id ? { ...t, [f]: v } : t));
  const toggleCategory = (cat: Category) =>
    setCategories(p => { const n = new Set(p); n.has(cat) ? n.delete(cat) : n.add(cat); return n; });

  // ── File upload ────────────────────────────────────────────
  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    setFileError(null);
    const res = await parseSheet(file);
    if (res.error) { setFileError(res.error); setSheet(null); }
    else setSheet(res);
    e.target.value = "";
  };

  // ── Run ────────────────────────────────────────────────────
  const start = async () => {
    const active = targets.filter(t => t.enabled && t.url.trim());
    if (!active.length || !goal.trim() || running) return;
    setRunning(true);
    setExpandedStep(null);
    const initial: TargetRun[] = active.map(t => ({ target: t, steps: [], result: null, status: "pending" }));
    setRuns(initial);
    setActiveTab(active[0].id);

    for (let i = 0; i < active.length; i++) {
      const target = active[i];
      setRuns(p => p.map((r, idx) => idx === i ? { ...r, status: "running" } : r));

      try {
        const res = await fetch("/api/human-agent/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            targetUrl: target.url,
            goal: goal.trim(),
            loginEmail: target.loginEmail || undefined,
            loginPassword: target.loginPassword || undefined,
            maxSteps,
            categories: Array.from(categories),
            customPrompt: customPrompt.trim() || undefined,
            sheetRawTable: sheet?.rawTable || undefined,
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
          const lines = buf.split("\n"); buf = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            try {
              const evt = JSON.parse(line.slice(6));
              if (evt.type === "step")
                setRuns(p => p.map((r, idx) => idx === i ? { ...r, steps: [...r.steps, evt.step] } : r));
              else if (evt.type === "complete")
                setRuns(p => p.map((r, idx) => idx === i ? { ...r, result: evt.result, status: evt.result.status } : r));
              else if (evt.type === "error")
                setRuns(p => p.map((r, idx) => idx === i ? { ...r, status: "error", error: evt.message } : r));
            } catch { /* ignore */ }
          }
        }
      } catch (err) {
        setRuns(p => p.map((r, idx) => idx === i ? { ...r, status: "error", error: String(err) } : r));
      }
    }
    setRunning(false);
  };

  const activeRun = runs.find(r => r.target.id === activeTab);
  const enabledCount = targets.filter(t => t.enabled && t.url.trim()).length;

  return (
    <div className="flex h-[calc(100vh-56px)]">
      {/* ── Left Panel ──────────────────────────────────────── */}
      {panelOpen && (
        <div className="w-80 shrink-0 border-r bg-gray-50 flex flex-col">
          <div className="p-4 border-b bg-white flex items-center justify-between">
            <div>
              <h2 className="font-semibold text-gray-800 text-sm">Human-mode Agent</h2>
              <p className="text-xs text-gray-500 mt-0.5">Qwen3-VL 인식 · GPT-4o 판단 · Playwright 실행</p>
            </div>
            <button onClick={() => setPanelOpen(false)} className="text-gray-400 hover:text-gray-600 text-lg">‹</button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-5">
            {/* Target URLs */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-gray-600">대상 URL</span>
                <button onClick={addTarget} disabled={running} className="text-xs text-blue-600 hover:text-blue-700 disabled:opacity-40">+ 추가</button>
              </div>
              <div className="space-y-2">
                {targets.map(t => (
                  <TargetCard key={t.id} target={t} disabled={running}
                    onChange={(f, v) => updateTarget(t.id, f, v)}
                    onRemove={targets.length > 1 ? () => removeTarget(t.id) : undefined}
                  />
                ))}
              </div>
            </div>

            {/* Goal */}
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">테스트 목표</label>
              <textarea
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 outline-none focus:border-blue-400 bg-white resize-none"
                rows={3} value={goal} onChange={e => setGoal(e.target.value)}
                placeholder="예: 채팅 위젯을 열고 메시지를 보낸 후 응답을 확인해줘" disabled={running}
              />
              <p className="text-xs text-gray-400 mt-0.5">자연어로 자유롭게 작성하세요</p>
            </div>

            {/* Sheet Upload */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium text-gray-600">시나리오 시트 (선택)</span>
                {sheet && <button onClick={() => setSheet(null)} className="text-xs text-gray-400 hover:text-red-500">✕ 제거</button>}
              </div>
              {sheet ? (
                <div className="text-xs bg-green-50 border border-green-200 rounded px-3 py-2 text-green-700">
                  📄 {sheet.fileName} · {sheet.rowCount}행 → AI 해석
                </div>
              ) : (
                <label className={`flex flex-col items-center gap-1 border-2 border-dashed rounded-lg py-3 cursor-pointer transition-colors ${fileError ? "border-red-300 bg-red-50" : "border-gray-200 hover:border-blue-300 hover:bg-blue-50"}`}>
                  <input ref={fileRef} type="file" accept=".json,.csv,.tsv,.xlsx,.xls" className="hidden" onChange={handleFile} disabled={running} />
                  <span className="text-xs text-gray-500">파일 업로드</span>
                  <span className="text-xs text-gray-400">.xlsx · .csv · .tsv · .json</span>
                </label>
              )}
              {fileError && <p className="text-xs text-red-500 mt-1">{fileError}</p>}
              {sheet && <p className="text-xs text-gray-400 mt-1">시트 내용이 테스트 컨텍스트로 AI에 전달됩니다</p>}
            </div>

            {/* Max Steps */}
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">최대 스텝 수: <span className="text-blue-600">{maxSteps}</span></label>
              <input type="range" min={5} max={30} step={5} value={maxSteps}
                onChange={e => setMaxSteps(Number(e.target.value))}
                className="w-full accent-blue-500" disabled={running} />
              <div className="flex justify-between text-xs text-gray-400"><span>5</span><span>30</span></div>
            </div>

            {/* Categories */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-gray-600">테스트 카테고리</span>
                <button onClick={() => setCategories(new Set(CATEGORIES.map(c => c.id)))} className="text-xs text-gray-400 hover:text-blue-500" disabled={running}>전체</button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {CATEGORIES.map(c => (
                  <button key={c.id} onClick={() => toggleCategory(c.id)} disabled={running}
                    className={`text-xs px-2 py-1 rounded-full border transition-colors ${categories.has(c.id) ? "bg-blue-100 border-blue-300 text-blue-700" : "bg-white border-gray-200 text-gray-400"}`}>
                    {c.emoji} {c.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Custom Instructions */}
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">사용자 지시사항 (선택)</label>
              <textarea
                className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 outline-none focus:border-blue-400 bg-white resize-none"
                rows={2} value={customPrompt} onChange={e => setCustomPrompt(e.target.value)}
                placeholder="예: 반드시 모바일 뷰포트 기준으로 테스트해줘" disabled={running}
              />
            </div>
          </div>

          <div className="p-4 border-t space-y-2">
            {enabledCount > 1 && (
              <p className="text-xs text-blue-600 text-center">{enabledCount}개 URL 순차 실행</p>
            )}
            <button onClick={start} disabled={running || enabledCount === 0 || !goal.trim()}
              className="w-full py-2.5 rounded-lg text-sm font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed bg-blue-600 hover:bg-blue-700 text-white">
              {running ? "실행 중..." : "▶ 테스트 시작"}
            </button>
          </div>
        </div>
      )}

      {/* ── Right Panel ─────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-4 py-2.5 border-b bg-white flex items-center gap-3">
          {!panelOpen && (
            <button onClick={() => setPanelOpen(true)} className="text-gray-400 hover:text-gray-600 text-lg">›</button>
          )}
          <span className="text-sm font-medium text-gray-700">실행 로그</span>
          {running && (
            <span className="flex items-center gap-1.5 text-xs text-blue-600">
              <span className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
              Qwen3-VL 인식 → GPT-4o 판단 중...
            </span>
          )}
          {runs.length > 0 && !running && (
            <span className="text-xs text-gray-400 ml-auto">{activeRun?.steps.length ?? 0} 스텝</span>
          )}
        </div>

        {/* Tabs */}
        {runs.length > 1 && (
          <div className="flex border-b overflow-x-auto bg-white">
            {runs.map(r => {
              const statusDot = r.status === "done" ? "bg-green-400" : r.status === "fail" ? "bg-red-400" : r.status === "running" ? "bg-blue-400 animate-pulse" : r.status === "error" ? "bg-red-400" : "bg-gray-300";
              return (
                <button key={r.target.id} onClick={() => setActiveTab(r.target.id)}
                  className={`px-4 py-2 text-xs whitespace-nowrap border-b-2 flex items-center gap-1.5 transition-colors ${activeTab === r.target.id ? "border-blue-500 text-blue-600 bg-blue-50" : "border-transparent text-gray-500 hover:text-gray-700"}`}>
                  <span className={`w-2 h-2 rounded-full ${statusDot}`} />
                  {r.target.label}
                </button>
              );
            })}
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          {/* Empty */}
          {runs.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-gray-400 gap-3">
              <div className="text-5xl">🤖</div>
              <p className="text-sm">목표를 입력하고 테스트를 시작하세요</p>
              <p className="text-xs text-gray-300">Qwen3-VL이 화면을 인식하고 GPT-4o가 판단합니다</p>
            </div>
          )}

          {/* Steps */}
          {activeRun && (
            <div className="divide-y">
              {activeRun.steps.map(step => (
                <StepCard key={step.stepNumber} step={step}
                  expanded={expandedStep === step.stepNumber}
                  onToggle={() => setExpandedStep(expandedStep === step.stepNumber ? null : step.stepNumber)}
                />
              ))}
            </div>
          )}

          {/* Running spinner */}
          {running && activeRun?.status === "running" && (
            <div className="p-4 flex items-center gap-3 text-sm text-gray-500">
              <span className="w-5 h-5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin shrink-0" />
              화면 분석 중...
            </div>
          )}

          {/* Result */}
          {activeRun?.result && (
            <div className={`m-6 p-4 rounded-lg border text-sm ${
              activeRun.result.status === "done" ? "bg-green-50 border-green-200 text-green-800" :
              activeRun.result.status === "fail" ? "bg-red-50 border-red-200 text-red-800" :
              "bg-yellow-50 border-yellow-200 text-yellow-800"
            }`}>
              <div className="font-semibold mb-1">
                {activeRun.result.status === "done" ? "✅ 완료" : activeRun.result.status === "fail" ? "❌ 버그 발견" : "⏱ 최대 스텝 도달"}
              </div>
              <p>{activeRun.result.summary}</p>
              <p className="text-xs mt-2 opacity-70">
                {activeRun.result.steps.length} 스텝 · {(activeRun.result.totalDurationMs / 1000).toFixed(1)}초
              </p>
            </div>
          )}

          {activeRun?.status === "error" && (
            <div className="m-6 p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              <strong>오류:</strong> {activeRun.error}
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </div>
    </div>
  );
}

// ─── Target Card ───────────────────────────────────────────────
function TargetCard({ target, onChange, onRemove, disabled }: {
  target: TargetEntry;
  onChange: <K extends keyof TargetEntry>(f: K, v: TargetEntry[K]) => void;
  onRemove?: () => void;
  disabled?: boolean;
}) {
  const [showAuth, setShowAuth] = useState(!!target.loginEmail);
  return (
    <div className={`rounded-lg border overflow-hidden ${target.enabled ? "border-blue-200" : "border-gray-200 opacity-60"}`}>
      <div className="flex items-center gap-1.5 px-2 py-1.5 bg-white">
        <input type="checkbox" checked={target.enabled} onChange={e => onChange("enabled", e.target.checked)} className="w-3.5 h-3.5 rounded shrink-0" disabled={disabled} />
        <input className="flex-1 text-xs font-medium bg-transparent border-none outline-none text-gray-700 min-w-0"
          value={target.label} onChange={e => onChange("label", e.target.value)} placeholder="레이블" disabled={disabled} />
        <button onClick={() => setShowAuth(v => !v)} className="text-xs text-gray-400 hover:text-gray-600 shrink-0" title="로그인 정보">🔑</button>
        {onRemove && <button onClick={onRemove} className="text-xs text-red-400 hover:text-red-600 shrink-0" disabled={disabled}>✕</button>}
      </div>
      <div className="px-2 pb-1.5">
        <input className="w-full text-xs border border-gray-200 rounded px-2 py-1 bg-white outline-none focus:border-blue-300"
          value={target.url} onChange={e => onChange("url", e.target.value)} placeholder="https://your-app.com" disabled={disabled} />
      </div>
      {showAuth && (
        <div className="px-2 pb-2 space-y-1 bg-gray-50 border-t">
          <input className="w-full text-xs border border-gray-200 rounded px-2 py-1 bg-white outline-none focus:border-blue-300 mt-1.5"
            type="email" value={target.loginEmail} onChange={e => onChange("loginEmail", e.target.value)} placeholder="이메일 (선택)" disabled={disabled} />
          <input className="w-full text-xs border border-gray-200 rounded px-2 py-1 bg-white outline-none focus:border-blue-300"
            type="password" value={target.loginPassword} onChange={e => onChange("loginPassword", e.target.value)} placeholder="비밀번호 (선택)" disabled={disabled} />
        </div>
      )}
    </div>
  );
}

// ─── Step Card ──────────────────────────────────────────────────
function StepCard({ step, expanded, onToggle }: { step: HumanStep; expanded: boolean; onToggle: () => void; }) {
  const { decision, success, error, screenshotPath, stepNumber, durationMs } = step;
  const colorClass = ACTION_COLORS[decision.action] ?? "bg-gray-100 text-gray-600";
  const icon = ACTION_ICONS[decision.action] ?? "•";

  return (
    <div className={!success ? "bg-red-50" : ""}>
      <button onClick={onToggle} className="w-full px-6 py-3 flex items-start gap-3 hover:bg-gray-50 transition-colors text-left">
        <span className="w-6 h-6 rounded-full bg-gray-200 text-gray-600 text-xs flex items-center justify-center shrink-0 mt-0.5 font-medium">{stepNumber}</span>
        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full shrink-0 mt-0.5 ${colorClass}`}>{icon} {decision.action}</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm text-gray-800 leading-snug">{decision.description}</p>
          {error && <p className="text-xs text-red-500 mt-0.5">⚠ {error}</p>}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs text-gray-400">{(durationMs / 1000).toFixed(1)}s</span>
          <svg className={`w-4 h-4 text-gray-400 transition-transform ${expanded ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {expanded && (
        <div className="px-6 pb-4 space-y-3 bg-gray-50 border-t">
          <div className="pt-3 flex gap-2 flex-wrap">
            <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full">👁 Qwen3-VL {(step.perceptionMs / 1000).toFixed(1)}s</span>
            <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">🧠 GPT-4o {(step.planningMs / 1000).toFixed(1)}s</span>
          </div>
          {step.perception && (
            <div>
              <p className="text-xs font-medium text-purple-600 mb-1">👁 Qwen3-VL 화면 인식</p>
              <pre className="text-xs text-gray-600 bg-white rounded px-3 py-2 border whitespace-pre-wrap font-sans leading-relaxed max-h-40 overflow-y-auto">{step.perception}</pre>
            </div>
          )}
          <div>
            <p className="text-xs font-medium text-blue-600 mb-1">🧠 GPT-4o 판단</p>
            <p className="text-xs text-gray-600 bg-white rounded px-3 py-2 border">{decision.observation}</p>
          </div>
          {(decision.target || decision.value) && (
            <div className="flex gap-4 text-xs flex-wrap">
              {decision.target && <div><span className="text-gray-400">target: </span><code className="bg-white border rounded px-1.5 py-0.5 text-gray-700">{decision.target}</code></div>}
              {decision.value && <div><span className="text-gray-400">value: </span><code className="bg-white border rounded px-1.5 py-0.5 text-gray-700">{decision.value}</code></div>}
            </div>
          )}
          {screenshotPath && (
            <div>
              <p className="text-xs font-medium text-gray-500 mb-1">📸 스크린샷</p>
              <a href={screenshotPath} target="_blank" rel="noopener noreferrer">
                <img src={screenshotPath} alt={`Step ${stepNumber}`}
                  className="rounded border max-h-64 object-top object-cover w-full cursor-pointer hover:opacity-90 transition-opacity" />
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
