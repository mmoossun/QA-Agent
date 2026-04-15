"use client";

import { useRef, useState } from "react";
import type { QAReport, QAScenario } from "@/lib/ai/types";

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
  { id: "auth",        label: "인증",      desc: "로그인·로그아웃·권한",      emoji: "🔐" },
  { id: "form",        label: "폼",        desc: "입력·유효성검사·제출",       emoji: "📝" },
  { id: "ui",          label: "UI",        desc: "렌더링·레이아웃·반응형",     emoji: "🎨" },
  { id: "navigation",  label: "네비게이션", desc: "페이지 이동·링크·라우팅",    emoji: "🗺️" },
  { id: "security",    label: "보안",      desc: "XSS·CSRF·접근제어",         emoji: "🛡️" },
  { id: "api",         label: "API",       desc: "요청·응답·에러 핸들링",      emoji: "⚡" },
  { id: "performance", label: "성능",      desc: "로드 속도·렌더링 시간",      emoji: "📈" },
];

interface AgentEvent {
  type: "start" | "progress" | "complete" | "error";
  stage?: string;
  message?: string;
  progress?: number;
  report?: QAReport;
  scenarios?: QAScenario[];
  data?: unknown;
}

interface TargetResult {
  target: TargetEntry;
  events: AgentEvent[];
  report: QAReport | null;
  status: "pending" | "running" | "done" | "error";
}

interface ParsedSheet {
  direct: QAScenario[];  // fully-specified scenarios (already have Playwright steps)
  hints: string[];       // text descriptions for AI to expand
  fileName: string;
  rowCount: number;
}

const DEFAULT_TARGETS: TargetEntry[] = [
  { id: "t1", label: "대시보드 (상담원용)",   url: "https://app-dev.generativelab.co.kr",              loginEmail: "qa-owner@example.com", loginPassword: "TestPassword123", enabled: true  },
  { id: "t2", label: "위젯 데모 (고객 채팅)", url: "https://d22ekkgk95jcrg.cloudfront.net/demo/index.html", loginEmail: "",                 loginPassword: "",               enabled: false },
];

// ─── CSV utils ────────────────────────────────────────────────
function parseCSVLine(line: string, sep = ","): string[] {
  const result: string[] = [];
  let cur = "";
  let inQ = false;
  for (const ch of line) {
    if (ch === '"') { inQ = !inQ; }
    else if (ch === sep && !inQ) { result.push(cur.trim()); cur = ""; }
    else { cur += ch; }
  }
  result.push(cur.trim());
  return result;
}

function isFullQAScenario(obj: unknown): obj is QAScenario {
  if (typeof obj !== "object" || obj === null) return false;
  const s = obj as Record<string, unknown>;
  return (
    typeof s.name === "string" &&
    Array.isArray(s.steps) &&
    s.steps.length > 0 &&
    typeof (s.steps[0] as Record<string, unknown>).action === "string"
  );
}

async function parseScenarioFile(file: File): Promise<ParsedSheet & { error?: string }> {
  const text = await file.text();

  if (file.name.endsWith(".json")) {
    try {
      const arr = JSON.parse(text);
      const rows = Array.isArray(arr) ? arr : [arr];

      if (rows.every(isFullQAScenario)) {
        return { direct: rows as QAScenario[], hints: [], fileName: file.name, rowCount: rows.length };
      }
      // Simple format → hints
      const hints = rows
        .map((r: Record<string, unknown>) => {
          const parts = [r.name ?? r.title ?? ""].filter(Boolean);
          if (r.description) parts.push(`(${r.description})`);
          if (r.category)    parts.push(`[카테고리:${r.category}]`);
          if (r.priority)    parts.push(`[우선순위:${r.priority}]`);
          return parts.join(" ").trim();
        })
        .filter(Boolean) as string[];
      return { direct: [], hints, fileName: file.name, rowCount: rows.length };
    } catch (e) {
      return { direct: [], hints: [], fileName: file.name, rowCount: 0, error: `JSON 파싱 오류: ${e}` };
    }
  }

  if (file.name.endsWith(".csv") || file.name.endsWith(".tsv")) {
    const sep = file.name.endsWith(".tsv") ? "\t" : ",";
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length < 2) return { direct: [], hints: [], fileName: file.name, rowCount: 0, error: "CSV 파일이 비어있습니다" };

    const headers = parseCSVLine(lines[0], sep).map((h) => h.toLowerCase().replace(/"/g, ""));
    const col = (name: string, alt?: string) => {
      const idx = headers.indexOf(name);
      return idx !== -1 ? idx : (alt ? headers.indexOf(alt) : -1);
    };
    const nameIdx = col("name", "테스트명");
    if (nameIdx === -1) return { direct: [], hints: [], fileName: file.name, rowCount: 0, error: '"name" 또는 "테스트명" 컬럼이 필요합니다' };

    const descIdx = col("description", "설명");
    const catIdx  = col("category", "카테고리");
    const priIdx  = col("priority", "우선순위");

    const hints = lines.slice(1).map((line) => {
      const cols = parseCSVLine(line, sep).map((c) => c.replace(/"/g, "").trim());
      const parts = [cols[nameIdx]];
      if (descIdx !== -1 && cols[descIdx]) parts.push(`(${cols[descIdx]})`);
      if (catIdx  !== -1 && cols[catIdx])  parts.push(`[카테고리:${cols[catIdx]}]`);
      if (priIdx  !== -1 && cols[priIdx])  parts.push(`[우선순위:${cols[priIdx]}]`);
      return parts.join(" ").trim();
    }).filter(Boolean);

    return { direct: [], hints, fileName: file.name, rowCount: hints.length };
  }

  return { direct: [], hints: [], fileName: file.name, rowCount: 0, error: "지원 형식: .json .csv .tsv" };
}

function downloadTemplate() {
  const csv = [
    "name,category,priority,description",
    '"로그인 정상 테스트","auth","critical","올바른 자격증명으로 로그인 시 대시보드 이동 확인"',
    '"잘못된 비밀번호 테스트","auth","high","틀린 비밀번호로 로그인 시 오류 메시지 확인"',
    '"폼 필수 입력 검사","form","medium","필수 입력란 비워둔 채 제출 시 오류 표시 확인"',
    '"설정 페이지 접근","navigation","medium","로그인 후 설정 메뉴 진입 가능 여부 확인"',
    '"권한 없는 URL 직접 접근","security","high","미인증 상태에서 보호 URL 접근 시 로그인 리다이렉트 확인"',
  ].join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "scenario_template.csv"; a.click();
  URL.revokeObjectURL(url);
}

function downloadScenariosJSON(scenarios: QAScenario[], name = "generated_scenarios") {
  const blob = new Blob([JSON.stringify(scenarios, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `${name}.json`; a.click();
  URL.revokeObjectURL(url);
}

// ─── Page ──────────────────────────────────────────────────────
export default function AgentPage() {
  const [targets, setTargets]           = useState<TargetEntry[]>(DEFAULT_TARGETS);
  const [categories, setCategories]     = useState<Set<Category>>(new Set(CATEGORIES.map((c) => c.id)));
  const [maxScenarios, setMaxScenarios] = useState(12);
  const [customPrompt, setCustomPrompt]   = useState("");
  const [reportLanguage, setReportLanguage] = useState<"ko" | "en">("ko");
  const [sheet, setSheet]               = useState<ParsedSheet | null>(null);
  const [fileError, setFileError]       = useState<string | null>(null);
  const fileRef                         = useRef<HTMLInputElement>(null);

  // Full run state
  const [isRunning, setIsRunning]   = useState(false);
  const [results, setResults]       = useState<TargetResult[]>([]);

  // Generate-only state
  const [isGenerating, setIsGenerating] = useState(false);
  const [genEvents, setGenEvents]       = useState<AgentEvent[]>([]);
  const [genScenarios, setGenScenarios] = useState<QAScenario[] | null>(null);

  // ── Helpers ────────────────────────────────────────────────
  const addTarget = () =>
    setTargets((p) => [...p, { id: `t${Date.now()}`, label: `URL ${p.length + 1}`, url: "", loginEmail: "", loginPassword: "", enabled: true }]);

  const removeTarget = (id: string) => setTargets((p) => p.filter((t) => t.id !== id));

  const updateTarget = <K extends keyof TargetEntry>(id: string, field: K, val: TargetEntry[K]) =>
    setTargets((p) => p.map((t) => (t.id === id ? { ...t, [field]: val } : t)));

  const toggleCategory = (cat: Category) =>
    setCategories((p) => { const n = new Set(p); n.has(cat) ? n.delete(cat) : n.add(cat); return n; });

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileError(null);
    const result = await parseScenarioFile(file);
    if (result.error) { setFileError(result.error); setSheet(null); }
    else { setSheet(result); }
    e.target.value = "";
  };

  const clearFile = () => { setSheet(null); setFileError(null); };

  const commonBody = (target: TargetEntry) => ({
    targetUrl: target.url,
    loginEmail:     target.loginEmail     || undefined,
    loginPassword:  target.loginPassword  || undefined,
    maxScenarios,
    scenarioCategories: Array.from(categories),
    customPrompt:   customPrompt.trim()   || undefined,
    directScenarios: sheet?.direct.length ? sheet.direct : undefined,
    scenarioHints:   sheet?.hints.length  ? sheet.hints  : undefined,
    reportLanguage,
  });

  // ── Full Run ───────────────────────────────────────────────
  const run = async () => {
    const active = targets.filter((t) => t.enabled && t.url.trim());
    if (active.length === 0) return;
    setIsRunning(true);
    setResults(active.map((t) => ({ target: t, events: [], report: null, status: "pending" })));

    for (let i = 0; i < active.length; i++) {
      const target = active[i];
      setResults((p) => p.map((r, idx) => idx === i ? { ...r, status: "running" } : r));

      try {
        const res = await fetch("/api/agent/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(commonBody(target)),
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
              const event: AgentEvent = JSON.parse(line.slice(6));
              setResults((p) => p.map((r, idx) => {
                if (idx !== i) return r;
                const u = { ...r, events: [...r.events, event] };
                if (event.type === "complete" && event.report) { u.report = event.report; u.status = "done"; }
                if (event.type === "error") u.status = "error";
                return u;
              }));
            } catch { /* ignore */ }
          }
        }

        setResults((p) => p.map((r, idx) => idx === i && r.status === "running" ? { ...r, status: "done" } : r));
      } catch (err) {
        setResults((p) => p.map((r, idx) =>
          idx === i ? { ...r, status: "error", events: [...r.events, { type: "error", message: String(err) }] } : r
        ));
      }
    }
    setIsRunning(false);
  };

  // ── Generate Only ──────────────────────────────────────────
  const generateOnly = async () => {
    const active = targets.filter((t) => t.enabled && t.url.trim());
    if (active.length === 0) return;
    setIsGenerating(true);
    setGenEvents([]);
    setGenScenarios(null);

    // Use first active target for generate-only
    const target = active[0];
    try {
      const res = await fetch("/api/agent/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetUrl: target.url,
          loginEmail:    target.loginEmail    || undefined,
          loginPassword: target.loginPassword || undefined,
          maxScenarios,
          scenarioCategories: Array.from(categories),
          customPrompt:  customPrompt.trim()  || undefined,
          scenarioHints: sheet?.hints.length  ? sheet.hints : undefined,
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
            const event: AgentEvent = JSON.parse(line.slice(6));
            setGenEvents((p) => [...p, event]);
            if (event.type === "complete" && event.scenarios) {
              setGenScenarios(event.scenarios);
            }
          } catch { /* ignore */ }
        }
      }
    } catch (err) {
      setGenEvents((p) => [...p, { type: "error", message: String(err) }]);
    }
    setIsGenerating(false);
  };

  const activeCount  = targets.filter((t) => t.enabled && t.url.trim()).length;
  const genProgress  = genEvents.reduce((m, e) => Math.max(m, e.progress ?? 0), 0);

  return (
    <div className="max-w-6xl mx-auto px-6 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">Autonomous QA Agent</h1>
        <p className="text-gray-500">URL과 카테고리를 설정하면 AI가 탐색 → 시나리오 생성 → 실행 → 리포트를 자동으로 수행합니다</p>
      </div>

      <div className="grid grid-cols-3 gap-6 mb-6">
        {/* ── Left column ───────────────────────────────────── */}
        <div className="col-span-1 space-y-4">

          {/* Target URLs */}
          <div className="card p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold text-gray-900">대상 URL</h2>
              <button onClick={addTarget} disabled={isRunning || isGenerating}
                className="text-xs text-blue-600 hover:text-blue-700 border border-blue-200 px-2 py-0.5 rounded hover:bg-blue-50 transition-colors">
                + 추가
              </button>
            </div>
            <div className="space-y-3">
              {targets.map((t) => (
                <AgentTargetCard key={t.id} target={t} disabled={isRunning || isGenerating}
                  onChange={(field, val) => updateTarget(t.id, field, val)}
                  onRemove={targets.length > 1 ? () => removeTarget(t.id) : undefined}
                />
              ))}
            </div>
          </div>

          {/* File Upload */}
          <div className="card p-5">
            <div className="flex items-center justify-between mb-2">
              <h2 className="font-semibold text-gray-900">📄 시나리오 시트 업로드</h2>
              <button onClick={downloadTemplate}
                className="text-xs text-gray-400 hover:text-blue-500 hover:underline transition-colors">
                템플릿 ↓
              </button>
            </div>
            <p className="text-xs text-gray-400 mb-3">
              CSV·JSON 파일의 시나리오를 AI 생성 시나리오와 함께 실행합니다
            </p>

            {sheet ? (
              <div className="rounded-lg border border-green-200 bg-green-50 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-xs font-semibold text-green-700 truncate">{sheet.fileName}</p>
                    <p className="text-xs text-green-600 mt-0.5">
                      {sheet.direct.length > 0
                        ? `${sheet.direct.length}개 시나리오 (완전 형식) 로드됨`
                        : `${sheet.hints.length}개 테스트 케이스 → AI가 Playwright 단계로 변환`}
                    </p>
                  </div>
                  <button onClick={clearFile} className="text-xs text-gray-400 hover:text-red-500 shrink-0">✕</button>
                </div>
                {sheet.direct.length > 0 && (
                  <div className="mt-2 max-h-24 overflow-y-auto space-y-0.5">
                    {sheet.direct.map((s, i) => (
                      <p key={i} className="text-xs text-green-700 truncate">• {s.name}</p>
                    ))}
                  </div>
                )}
                {sheet.hints.length > 0 && (
                  <div className="mt-2 max-h-24 overflow-y-auto space-y-0.5">
                    {sheet.hints.map((h, i) => (
                      <p key={i} className="text-xs text-green-700 truncate">• {h}</p>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <label className={`flex flex-col items-center justify-center gap-2 border-2 border-dashed rounded-lg py-5 cursor-pointer transition-colors ${fileError ? "border-red-300 bg-red-50" : "border-gray-200 hover:border-blue-300 hover:bg-blue-50"}`}>
                <input ref={fileRef} type="file" accept=".json,.csv,.tsv" className="hidden" onChange={handleFileChange} disabled={isRunning || isGenerating} />
                <span className="text-2xl">📂</span>
                <span className="text-xs text-gray-500">클릭하거나 파일을 드래그하세요</span>
                <span className="text-xs text-gray-400">.json · .csv · .tsv</span>
              </label>
            )}
            {fileError && <p className="text-xs text-red-500 mt-1.5">{fileError}</p>}
          </div>

          {/* Max scenarios slider */}
          <div className="card p-5">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-gray-700">최대 AI 생성 시나리오</span>
              <span className="text-sm font-bold text-blue-600">{maxScenarios}개</span>
            </div>
            <input type="range" min={5} max={30} value={maxScenarios}
              onChange={(e) => setMaxScenarios(Number(e.target.value))}
              disabled={isRunning || isGenerating}
              className="w-full accent-blue-600" />
            <div className="flex justify-between text-xs text-gray-400 mt-1"><span>5</span><span>30</span></div>
            {sheet && sheet.direct.length > 0 && (
              <p className="text-xs text-gray-400 mt-1.5">+ 파일 시나리오 {sheet.direct.length}개 추가 실행</p>
            )}
          </div>

          {/* Action buttons */}
          <div className="space-y-2">
            <button onClick={run}
              disabled={isRunning || isGenerating || activeCount === 0 || categories.size === 0}
              className="btn-primary w-full">
              {isRunning
                ? <span className="flex items-center justify-center gap-2"><span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />실행 중...</span>
                : `▶ 에이전트 시작 (${activeCount}개 URL)`}
            </button>

            <button onClick={generateOnly}
              disabled={isRunning || isGenerating || activeCount === 0 || categories.size === 0}
              className="w-full py-2.5 px-4 rounded-lg border-2 border-purple-200 text-purple-700 bg-purple-50 hover:bg-purple-100 hover:border-purple-300 font-medium text-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
              {isGenerating
                ? <span className="flex items-center justify-center gap-2"><span className="w-4 h-4 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />생성 중...</span>
                : "📋 시나리오만 생성 (실행 없음)"}
            </button>

            {activeCount === 0 && <p className="text-xs text-red-400 text-center">URL을 1개 이상 활성화하세요</p>}
            {categories.size === 0 && <p className="text-xs text-red-400 text-center">카테고리를 1개 이상 선택하세요</p>}
            {activeCount > 1 && (
              <p className="text-xs text-gray-400 text-center">시나리오만 생성은 첫 번째 활성 URL 기준</p>
            )}
          </div>
        </div>

        {/* ── Right column ──────────────────────────────────── */}
        <div className="col-span-2 space-y-4">

          {/* Category selector */}
          <div className="card p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-gray-900">시나리오 카테고리</h2>
              <div className="flex gap-2">
                <button onClick={() => setCategories(new Set(CATEGORIES.map((c) => c.id)))} className="text-xs text-blue-600 hover:underline">전체 선택</button>
                <span className="text-gray-300">|</span>
                <button onClick={() => setCategories(new Set())} className="text-xs text-gray-500 hover:underline">전체 해제</button>
              </div>
            </div>
            <p className="text-xs text-gray-400 mb-4">선택한 카테고리 중심으로 AI가 시나리오를 생성합니다. 더 적은 카테고리 = 더 깊은 테스트.</p>
            <div className="grid grid-cols-2 gap-3">
              {CATEGORIES.map((cat) => {
                const selected = categories.has(cat.id);
                return (
                  <label key={cat.id}
                    className={`flex items-start gap-3 p-4 rounded-xl border cursor-pointer select-none transition-all ${selected ? "border-blue-200 bg-blue-50" : "border-gray-100 hover:border-gray-200 bg-white"}`}>
                    <input type="checkbox" checked={selected} onChange={() => toggleCategory(cat.id)}
                      disabled={isRunning || isGenerating}
                      className="mt-0.5 w-4 h-4 rounded border-gray-300 accent-blue-600" />
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-base">{cat.emoji}</span>
                        <span className={`text-sm font-semibold ${selected ? "text-blue-700" : "text-gray-700"}`}>{cat.label}</span>
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

          {/* Custom prompt */}
          <div className="card p-5">
            <div className="flex items-center justify-between mb-2">
              <h2 className="font-semibold text-gray-900">✏️ 사용자 지시사항 (선택)</h2>
              <div className="flex items-center gap-1 text-xs">
                <span className="text-gray-400">리포트 언어</span>
                <button
                  onClick={() => setReportLanguage("ko")}
                  className={`px-2 py-0.5 rounded-l border transition-colors ${reportLanguage === "ko" ? "bg-blue-600 text-white border-blue-600" : "bg-white text-gray-500 border-gray-200 hover:border-blue-300"}`}
                >한국어</button>
                <button
                  onClick={() => setReportLanguage("en")}
                  className={`px-2 py-0.5 rounded-r border-t border-b border-r transition-colors ${reportLanguage === "en" ? "bg-blue-600 text-white border-blue-600" : "bg-white text-gray-500 border-gray-200 hover:border-blue-300"}`}
                >English</button>
              </div>
              {customPrompt.trim() && (
                <button onClick={() => setCustomPrompt("")} className="text-xs text-gray-400 hover:text-red-500 transition-colors">초기화</button>
              )}
            </div>
            <p className="text-xs text-gray-400 mb-3">
              AI 시나리오 생성 시 반영할 추가 지시사항을 자연어로 입력하세요
            </p>
            <textarea
              value={customPrompt}
              onChange={(e) => setCustomPrompt(e.target.value)}
              disabled={isRunning || isGenerating}
              placeholder={`예시:\n• 모바일 뷰포트(375px) 환경도 테스트해줘\n• 한국어 에러 메시지가 정확히 표시되는지 확인해줘\n• 비밀번호 찾기 플로우는 반드시 포함해줘\n• 결제 관련 시나리오는 제외해줘`}
              rows={5}
              maxLength={2000}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-purple-300 resize-none text-gray-700 placeholder-gray-300 disabled:bg-gray-50"
            />
            <div className="flex justify-between items-center mt-1.5">
              <div className="flex gap-2 flex-wrap">
                {["로그인 플로우를 가장 꼼꼼하게 테스트해줘", "권한별 접근 제어 위주로 생성해줘", "에러 케이스·경계값 위주로 생성해줘"].map((ex) => (
                  <button key={ex} onClick={() => setCustomPrompt(ex)} disabled={isRunning || isGenerating}
                    className="text-xs text-purple-500 hover:text-purple-700 border border-purple-200 hover:border-purple-400 rounded px-1.5 py-0.5 transition-colors">
                    {ex.length > 18 ? ex.slice(0, 18) + "…" : ex}
                  </button>
                ))}
              </div>
              <span className="text-xs text-gray-300 shrink-0">{customPrompt.length}/2000</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Generate-only result ─────────────────────────────── */}
      {(isGenerating || genScenarios !== null || genEvents.length > 0) && (
        <div className="mb-6">
          <GenerateResultPanel
            events={genEvents}
            scenarios={genScenarios}
            isGenerating={isGenerating}
            progress={genProgress}
          />
        </div>
      )}

      {/* ── Full run results ─────────────────────────────────── */}
      {results.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-xl font-bold text-gray-900">실행 결과</h2>
          {results.map((r, i) => <AgentResultCard key={i} result={r} />)}
        </div>
      )}
    </div>
  );
}

// ─── Generate Result Panel ─────────────────────────────────────
function GenerateResultPanel({
  events, scenarios, isGenerating, progress,
}: {
  events: AgentEvent[];
  scenarios: QAScenario[] | null;
  isGenerating: boolean;
  progress: number;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const hasError = events.some((e) => e.type === "error");

  return (
    <div className="card overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 bg-purple-50 border-b border-purple-100">
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-purple-900">📋 시나리오 생성 결과</span>
          {scenarios && <span className="text-xs text-purple-600 bg-purple-100 px-2 py-0.5 rounded-full">{scenarios.length}개 생성</span>}
        </div>
        <div className="flex items-center gap-3">
          {scenarios && (
            <button onClick={() => downloadScenariosJSON(scenarios)}
              className="text-xs text-purple-600 hover:text-purple-800 border border-purple-200 hover:border-purple-400 px-2.5 py-1 rounded transition-colors">
              JSON 다운로드 ↓
            </button>
          )}
          {isGenerating
            ? <span className="flex items-center gap-1.5 text-xs text-purple-600 bg-purple-100 px-2 py-0.5 rounded-full">
                <span className="w-3 h-3 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
                {progress > 0 ? `${progress}%` : "생성 중..."}
              </span>
            : hasError
              ? <span className="text-xs text-red-600 bg-red-50 px-2 py-0.5 rounded-full">오류</span>
              : scenarios
                ? <span className="text-xs text-green-600 bg-green-50 px-2 py-0.5 rounded-full font-medium">완료</span>
                : null}
        </div>
      </div>

      {/* Progress bar */}
      {isGenerating && progress > 0 && (
        <div className="h-1 bg-gray-100">
          <div className="h-full bg-purple-500 transition-all duration-500" style={{ width: `${progress}%` }} />
        </div>
      )}

      <div className="p-5 space-y-4">
        {/* Log */}
        <div>
          <h3 className="text-xs font-semibold text-gray-500 uppercase mb-2">진행 로그</h3>
          <div className="bg-gray-50 rounded-lg p-3 max-h-36 overflow-y-auto space-y-1 font-mono text-xs">
            {events.length === 0
              ? <span className="text-gray-400">탐색 시작 중...</span>
              : events.map((e, i) => (
                  <div key={i} className={`flex gap-2 ${e.type === "error" ? "text-red-600" : e.type === "complete" ? "text-green-600" : "text-gray-600"}`}>
                    <span className="text-gray-300 shrink-0 w-4 text-right">{i + 1}</span>
                    <span className="text-purple-500 shrink-0 w-20 uppercase">[{e.stage ?? e.type}]</span>
                    <span className="flex-1">{e.message}</span>
                    {e.progress !== undefined && <span className="text-gray-400 shrink-0">{e.progress}%</span>}
                  </div>
                ))}
          </div>
        </div>

        {/* Scenario list */}
        {scenarios && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-semibold text-gray-500 uppercase">생성된 시나리오</h3>
              <span className="text-xs text-gray-400">클릭하면 상세 단계 확인</span>
            </div>
            <div className="space-y-1.5 max-h-[480px] overflow-y-auto pr-1">
              {scenarios.map((s) => (
                <div key={s.id}
                  className={`rounded-lg border cursor-pointer transition-colors ${expandedId === s.id ? "border-purple-200 bg-purple-50" : "border-gray-100 hover:border-gray-200 bg-white"}`}
                  onClick={() => setExpandedId(expandedId === s.id ? null : s.id)}>
                  <div className="flex items-center gap-2 px-3 py-2">
                    <span className={`text-xs px-1.5 py-0.5 rounded font-bold min-w-[44px] text-center shrink-0 ${
                      s.priority === "critical" ? "bg-red-50 text-red-700" :
                      s.priority === "high"     ? "bg-orange-50 text-orange-700" :
                      s.priority === "medium"   ? "bg-yellow-50 text-yellow-700" :
                                                  "bg-gray-50 text-gray-600"
                    }`}>{s.priority}</span>
                    <span className="text-xs text-gray-400 font-mono shrink-0">{s.id}</span>
                    <span className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded shrink-0">{s.category}</span>
                    <span className="text-sm text-gray-800 font-medium flex-1 truncate">{s.name}</span>
                    <span className="text-xs text-gray-400 shrink-0">{s.steps.length}단계</span>
                    <span className="text-xs text-gray-300">{expandedId === s.id ? "▲" : "▼"}</span>
                  </div>

                  {expandedId === s.id && (
                    <div className="px-3 pb-3 border-t border-purple-100 pt-2 space-y-1">
                      {s.steps.map((step, si) => (
                        <div key={si} className="flex gap-2 text-xs">
                          <span className="text-gray-300 shrink-0 w-4 text-right">{si + 1}</span>
                          <span className={`font-mono shrink-0 w-20 ${
                            step.action === "assert"     ? "text-green-600" :
                            step.action === "waitForUrl" ? "text-blue-600" :
                            step.action === "fill"       ? "text-orange-600" :
                            step.action === "navigate"   ? "text-purple-600" :
                                                          "text-gray-500"
                          }`}>{step.action}</span>
                          <span className="text-gray-600 flex-1">{step.description}</span>
                          {step.value && <span className="text-gray-400 truncate max-w-[120px]">{step.value}</span>}
                        </div>
                      ))}
                      {s.expectedResult && (
                        <p className="text-xs text-gray-500 mt-1.5 pl-6 italic">예상 결과: {s.expectedResult}</p>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
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
      <div className="flex items-center gap-2 px-3 py-2 bg-gray-50">
        <input type="checkbox" checked={target.enabled}
          onChange={(e) => onChange("enabled", e.target.checked)}
          disabled={disabled} className="w-4 h-4 rounded border-gray-300 shrink-0" />
        <input className="flex-1 text-xs font-medium bg-transparent border-none outline-none text-gray-700 min-w-0"
          value={target.label} onChange={(e) => onChange("label", e.target.value)}
          disabled={disabled} placeholder="레이블" />
        <button onClick={() => setShowAuth((v) => !v)}
          className={`text-xs shrink-0 px-1.5 py-0.5 rounded border transition-colors ${showAuth ? "border-blue-200 text-blue-600 bg-blue-50" : "border-gray-200 text-gray-400 hover:text-gray-600"}`}
          title="로그인 정보 설정">🔑</button>
        {onRemove && (
          <button onClick={onRemove} disabled={disabled} className="text-xs text-red-400 hover:text-red-600 shrink-0">✕</button>
        )}
      </div>
      <div className="px-3 py-2">
        <input className="input text-sm" value={target.url}
          onChange={(e) => onChange("url", e.target.value)}
          disabled={disabled} placeholder="https://your-app.com" />
      </div>
      {showAuth && (
        <div className="px-3 pb-3 space-y-2 border-t pt-2">
          <p className="text-xs text-gray-400">로그인 정보 (선택)</p>
          <input className="input text-sm" type="email" value={target.loginEmail}
            onChange={(e) => onChange("loginEmail", e.target.value)}
            disabled={disabled} placeholder="이메일" />
          <input className="input text-sm" type="password" value={target.loginPassword}
            onChange={(e) => onChange("loginPassword", e.target.value)}
            disabled={disabled} placeholder="비밀번호" />
        </div>
      )}
    </div>
  );
}

// ─── Agent Result Card ─────────────────────────────────────────
function AgentResultCard({ result }: { result: TargetResult }) {
  const { target, events, report, status } = result;
  const [collapsed, setCollapsed] = useState(false);
  const progress = events.reduce((m, e) => Math.max(m, e.progress ?? 0), 0);

  const statusBadge = {
    pending: <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">대기</span>,
    running: <span className="flex items-center gap-1.5 text-xs text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">
      <span className="w-3 h-3 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      실행 중 {progress > 0 && `${progress}%`}
    </span>,
    done:  <span className="text-xs text-green-600 bg-green-50 px-2 py-0.5 rounded-full font-medium">완료</span>,
    error: <span className="text-xs text-red-600 bg-red-50 px-2 py-0.5 rounded-full font-medium">오류</span>,
  }[status];

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 bg-gray-50 border-b cursor-pointer"
        onClick={() => setCollapsed((v) => !v)}>
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-gray-900">{target.label}</span>
          <a href={target.url} target="_blank" rel="noreferrer"
            className="text-xs text-blue-400 hover:underline"
            onClick={(e) => e.stopPropagation()}>
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
              <span className="text-xl font-bold text-blue-600">{report.score}<span className="text-xs text-gray-400 font-normal">/100</span></span>
            </>
          )}
          {statusBadge}
          <span className="text-gray-400 text-xs">{collapsed ? "▲" : "▼"}</span>
        </div>
      </div>

      {status === "running" && progress > 0 && (
        <div className="h-1 bg-gray-100">
          <div className="h-full bg-blue-500 transition-all duration-500" style={{ width: `${progress}%` }} />
        </div>
      )}

      {!collapsed && (
        <div className="p-5 space-y-4">
          <div>
            <h3 className="text-xs font-semibold text-gray-500 uppercase mb-2">실행 로그</h3>
            <div className="bg-gray-50 rounded-lg p-3 max-h-48 overflow-y-auto space-y-1.5 font-mono text-xs">
              {events.length === 0
                ? <span className="text-gray-400">로그 없음</span>
                : events.map((e, i) => (
                    <div key={i} className={`flex gap-2 ${e.type === "error" ? "text-red-600" : e.type === "complete" ? "text-green-600" : "text-gray-600"}`}>
                      <span className="text-gray-300 shrink-0 w-5 text-right">{i + 1}</span>
                      <span className="text-blue-500 shrink-0 w-20 uppercase">[{e.stage ?? e.type}]</span>
                      <span className="flex-1">{e.message}</span>
                      {e.progress !== undefined && <span className="text-gray-400 shrink-0">{e.progress}%</span>}
                    </div>
                  ))}
            </div>
          </div>

          {report && (
            <>
              <div className="grid grid-cols-4 gap-3">
                {[
                  { label: "PASS",      value: report.passed,                color: "text-green-600",  bg: "bg-green-50"  },
                  { label: "FAIL",      value: report.failed,                color: "text-red-600",    bg: "bg-red-50"    },
                  { label: "ERROR",     value: report.errors,                color: "text-yellow-600", bg: "bg-yellow-50" },
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
                <a href={`/reports/${report.runId}.html`} target="_blank" rel="noreferrer"
                  className="text-xs text-blue-500 hover:underline">HTML 리포트 전체 보기 →</a>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
