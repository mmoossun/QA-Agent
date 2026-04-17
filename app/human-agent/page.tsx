"use client";

import { useRef, useState } from "react";
import * as XLSX from "xlsx";
import type { HumanStep, HumanAgentResult } from "@/lib/human-agent/runner";
import type { TestReport } from "@/lib/human-agent/report-generator";
import { generateReportHTML, triggerDownload, safeFilename } from "@/lib/human-agent/report-export";
import type { TestCase } from "@/lib/google-sheets";

// ─── Types ─────────────────────────────────────────────────────
interface TargetEntry {
  id: string; label: string; url: string;
  loginEmail: string; loginPassword: string; enabled: boolean;
}

type Mode = "generate" | "run";

type Category = "기능 테스트" | "UI/UX" | "엣지 케이스" | "보안" | "성능" | "접근성" | "회귀";
const CATEGORIES: { id: Category; emoji: string }[] = [
  { id: "기능 테스트", emoji: "⚙️" },
  { id: "UI/UX",      emoji: "🎨" },
  { id: "엣지 케이스", emoji: "🔬" },
  { id: "보안",       emoji: "🛡️" },
  { id: "성능",       emoji: "📈" },
  { id: "접근성",     emoji: "♿" },
  { id: "회귀",       emoji: "🔁" },
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
const PRIORITY_COLORS: Record<string, string> = {
  High: "bg-red-100 text-red-700",
  Medium: "bg-yellow-100 text-yellow-700",
  Low: "bg-green-100 text-green-700",
};

// ─── File parsing ─────────────────────────────────────────────
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
  // ── Shared state ──────────────────────────────────────────
  const [mode, setMode]                 = useState<Mode>("generate");
  const [targets, setTargets]           = useState<TargetEntry[]>(DEFAULT_TARGETS);
  const [goal, setGoal]                 = useState("채팅 위젯을 열고 '안녕하세요' 메시지를 보낸 후 응답을 확인해줘");
  const [categories, setCategories]     = useState<Set<Category>>(new Set(CATEGORIES.map(c => c.id)));
  const [customPrompt, setCustomPrompt] = useState("");
  const [sheet, setSheet]               = useState<ParsedSheet | null>(null);
  const [fileError, setFileError]       = useState<string | null>(null);
  const [panelOpen, setPanelOpen]       = useState(true);
  const fileRef                         = useRef<HTMLInputElement>(null);

  // ── Generate mode state ───────────────────────────────────
  const [caseCount, setCaseCount]       = useState(10);
  const [testCases, setTestCases]       = useState<TestCase[]>([]);
  const [generating, setGenerating]     = useState(false);
  const [genError, setGenError]         = useState<string | null>(null);
  const [sheetId, setSheetId]           = useState("");
  const [exportStatus, setExportStatus] = useState<string | null>(null);
  const [exporting, setExporting]       = useState(false);
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [importing, setImporting]       = useState(false);

  // ── Run mode state ────────────────────────────────────────
  const [maxSteps, setMaxSteps]         = useState(20);
  const [runs, setRuns]                 = useState<TargetRun[]>([]);
  const [running, setRunning]           = useState(false);
  const [activeTab, setActiveTab]       = useState<string>("");
  const [expandedStep, setExpandedStep] = useState<number | null>(null);
  const [reports, setReports]           = useState<Record<string, TestReport>>({});
  const [reportView, setReportView]     = useState<"steps" | "report">("steps");
  const bottomRef                       = useRef<HTMLDivElement>(null);

  // ── Helpers ───────────────────────────────────────────────
  const addTarget = () => setTargets(p => [...p, { id: `t${Date.now()}`, label: `URL ${p.length + 1}`, url: "", loginEmail: "", loginPassword: "", enabled: true }]);
  const removeTarget = (id: string) => setTargets(p => p.filter(t => t.id !== id));
  const updateTarget = <K extends keyof TargetEntry>(id: string, f: K, v: TargetEntry[K]) =>
    setTargets(p => p.map(t => t.id === id ? { ...t, [f]: v } : t));
  const toggleCategory = (cat: Category) =>
    setCategories(p => { const n = new Set(p); n.has(cat) ? n.delete(cat) : n.add(cat); return n; });

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    setFileError(null);
    const res = await parseSheet(file);
    if (res.error) { setFileError(res.error); setSheet(null); }
    else setSheet(res);
    e.target.value = "";
  };

  const primaryUrl = targets.find(t => t.enabled && t.url.trim())?.url ?? "";

  // ── Generate test cases ───────────────────────────────────
  const generate = async () => {
    if (!primaryUrl || generating) return;
    setGenerating(true);
    setGenError(null);
    setTestCases([]);
    try {
      const res = await fetch("/api/human-agent/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetUrl: primaryUrl,
          goal: goal.trim(),
          categories: Array.from(categories),
          customPrompt: customPrompt.trim() || undefined,
          sheetRawTable: sheet?.rawTable || undefined,
          count: caseCount,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "생성 실패");
      setTestCases(data.testCases ?? []);
    } catch (e) {
      setGenError(String(e));
    } finally {
      setGenerating(false);
    }
  };

  // ── Export to Google Sheets ───────────────────────────────
  const exportToSheets = async () => {
    if (!sheetId.trim() || testCases.length === 0 || exporting) return;
    setExporting(true);
    setExportStatus(null);
    try {
      const res = await fetch("/api/google-sheets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sheetId: sheetId.trim(), testCases }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "내보내기 실패");
      setExportStatus(`✅ ${data.appended}개 테스트 케이스가 시트에 추가됐습니다`);
    } catch (e) {
      setExportStatus(`❌ ${String(e)}`);
    } finally {
      setExporting(false);
    }
  };

  // ── Import from Google Sheets ─────────────────────────────
  const importFromSheets = async () => {
    if (!sheetId.trim() || importing) return;
    setImporting(true);
    setImportStatus(null);
    try {
      const res = await fetch(`/api/google-sheets?sheetId=${encodeURIComponent(sheetId.trim())}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "불러오기 실패");
      setTestCases(data.testCases ?? []);
      setImportStatus(`✅ ${data.testCases?.length ?? 0}개 테스트 케이스를 불러왔습니다`);
    } catch (e) {
      setImportStatus(`❌ ${String(e)}`);
    } finally {
      setImporting(false);
    }
  };

  // ── Export to CSV ─────────────────────────────────────────
  const exportCSV = () => {
    if (!testCases.length) return;
    const headers = ["ID", "Category", "Title", "Steps", "Expected Result", "Priority", "Status", "Notes"];
    const rows = testCases.map(tc => [tc.id, tc.category, tc.title, tc.steps, tc.expectedResult, tc.priority, tc.status, tc.notes]
      .map(v => `"${String(v).replace(/"/g, '""')}"`).join(","));
    const csv = [headers.join(","), ...rows].join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = `test-cases-${Date.now()}.csv`; a.click();
  };

  // ── Save completed run to dashboard ──────────────────────
  const saveToDashboard = async (target: TargetEntry, result: HumanAgentResult) => {
    try {
      const passCount = result.steps.filter(s => s.success).length;
      const failCount = result.steps.filter(s => !s.success).length;
      await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "human",
          targetUrl: target.url,
          scenarioCount: result.steps.length,
          passCount,
          failCount,
          score: null,
          passRate: result.steps.length > 0 ? (passCount / result.steps.length * 100) : 0,
          duration: result.totalDurationMs,
          status: result.status === "done" ? "completed" : "failed",
          summary: result.summary,
        }),
      });
    } catch { /* non-critical */ }
  };

  // ── SSE stream loop (shared) ──────────────────────────────
  const streamRun = async (
    i: number,
    target: TargetEntry,
    body: Record<string, unknown>,
  ) => {
    const res = await fetch("/api/human-agent/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
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
          else if (evt.type === "complete") {
            setRuns(p => p.map((r, idx) => idx === i ? { ...r, result: evt.result, status: evt.result.status } : r));
            saveToDashboard(target, evt.result);
          } else if (evt.type === "report") {
            setReports(p => ({ ...p, [target.id]: evt.report }));
            setReportView("report");
          } else if (evt.type === "error")
            setRuns(p => p.map((r, idx) => idx === i ? { ...r, status: "error", error: evt.message } : r));
        } catch { /* ignore */ }
      }
    }
  };

  // ── Run agent ─────────────────────────────────────────────
  const startRun = async () => {
    const active = targets.filter(t => t.enabled && t.url.trim());
    if (!active.length || running) return;
    setRunning(true);
    setExpandedStep(null);
    setReports({});
    setReportView("steps");
    const initial: TargetRun[] = active.map(t => ({ target: t, steps: [], result: null, status: "pending" }));
    setRuns(initial);
    setActiveTab(active[0].id);

    for (let i = 0; i < active.length; i++) {
      const target = active[i];
      setRuns(p => p.map((r, idx) => idx === i ? { ...r, status: "running" } : r));
      try {
        await streamRun(i, target, {
          targetUrl: target.url,
          goal: goal.trim(),
          loginEmail: target.loginEmail || undefined,
          loginPassword: target.loginPassword || undefined,
          maxSteps,
          categories: Array.from(categories),
          customPrompt: customPrompt.trim() || undefined,
          sheetRawTable: sheet?.rawTable || undefined,
        });
      } catch (err) {
        setRuns(p => p.map((r, idx) => idx === i ? { ...r, status: "error", error: String(err) } : r));
      }
    }
    setRunning(false);
  };

  // ── Run agent using generated test cases ─────────────────
  const runFromCases = async () => {
    const active = targets.filter(t => t.enabled && t.url.trim());
    if (!active.length || testCases.length === 0 || running) return;

    // Synthesize goal and inject test cases as structured context
    const synthesizedGoal = goal.trim() || "다음 테스트 케이스들을 순서대로 실행하며 QA를 수행해주세요";
    const casesList = testCases.slice(0, 20)
      .map(tc => `[${tc.id}] ${tc.title}\n스텝: ${tc.steps}\n기대결과: ${tc.expectedResult}`)
      .join("\n\n");
    const synthesizedCustomPrompt = [
      `실행할 테스트 케이스 목록 (${testCases.length}개):`,
      casesList,
      customPrompt.trim() ? `\n추가 지시사항: ${customPrompt.trim()}` : "",
    ].filter(Boolean).join("\n");

    setMode("run");
    setRunning(true);
    setExpandedStep(null);
    setReports({});
    setReportView("steps");
    const initial: TargetRun[] = active.map(t => ({ target: t, steps: [], result: null, status: "pending" }));
    setRuns(initial);
    setActiveTab(active[0].id);

    for (let i = 0; i < active.length; i++) {
      const target = active[i];
      setRuns(p => p.map((r, idx) => idx === i ? { ...r, status: "running" } : r));
      try {
        await streamRun(i, target, {
          targetUrl: target.url,
          goal: synthesizedGoal,
          loginEmail: target.loginEmail || undefined,
          loginPassword: target.loginPassword || undefined,
          maxSteps,
          categories: Array.from(categories),
          customPrompt: synthesizedCustomPrompt,
          sheetRawTable: sheet?.rawTable || undefined,
        });
      } catch (err) {
        setRuns(p => p.map((r, idx) => idx === i ? { ...r, status: "error", error: String(err) } : r));
      }
    }
    setRunning(false);
  };

  const activeRun = runs.find(r => r.target.id === activeTab);
  const enabledCount = targets.filter(t => t.enabled && t.url.trim()).length;
  const busy = generating || running || exporting || importing;

  // ── Shared left panel settings ────────────────────────────
  const sharedSettings = (
    <div className="flex-1 overflow-y-auto p-4 space-y-5">
      {/* Target URLs */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-gray-600">대상 URL</span>
          <button onClick={addTarget} disabled={busy} className="text-xs text-blue-600 hover:text-blue-700 disabled:opacity-40">+ 추가</button>
        </div>
        <div className="space-y-2">
          {targets.map(t => (
            <TargetCard key={t.id} target={t} disabled={busy}
              onChange={(f, v) => updateTarget(t.id, f, v)}
              onRemove={targets.length > 1 ? () => removeTarget(t.id) : undefined}
            />
          ))}
        </div>
      </div>

      {/* Goal */}
      <div>
        <label className="text-xs font-medium text-gray-600 block mb-1">테스트 목표 <span className="text-gray-400 font-normal">(선택)</span></label>
        <textarea className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 outline-none focus:border-blue-400 bg-white resize-none"
          rows={3} value={goal} onChange={e => setGoal(e.target.value)}
          placeholder="예: 채팅 위젯을 열고 메시지를 보낸 후 응답을 확인해줘&#10;&#10;비워두면 AI가 최적 시나리오를 자유롭게 판단합니다" disabled={busy} />
        <p className="text-xs text-gray-400 mt-0.5">비워두면 AI가 사이트를 자유롭게 탐색하며 QA를 수행합니다</p>
      </div>

      {/* Sheet Upload */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs font-medium text-gray-600">시나리오 시트 (선택)</span>
          {sheet && <button onClick={() => setSheet(null)} className="text-xs text-gray-400 hover:text-red-500">✕ 제거</button>}
        </div>
        {sheet ? (
          <div className="text-xs bg-green-50 border border-green-200 rounded px-3 py-2 text-green-700">
            📄 {sheet.fileName} · {sheet.rowCount}행
          </div>
        ) : (
          <label className={`flex flex-col items-center gap-1 border-2 border-dashed rounded-lg py-3 cursor-pointer transition-colors ${fileError ? "border-red-300 bg-red-50" : "border-gray-200 hover:border-blue-300 hover:bg-blue-50"}`}>
            <input ref={fileRef} type="file" accept=".json,.csv,.tsv,.xlsx,.xls" className="hidden" onChange={handleFile} disabled={busy} />
            <span className="text-xs text-gray-500">파일 업로드</span>
            <span className="text-xs text-gray-400">.xlsx · .csv · .tsv · .json</span>
          </label>
        )}
        {fileError && <p className="text-xs text-red-500 mt-1">{fileError}</p>}
      </div>

      {/* Categories */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-gray-600">테스트 카테고리</span>
          <button onClick={() => setCategories(new Set(CATEGORIES.map(c => c.id)))} className="text-xs text-gray-400 hover:text-blue-500" disabled={busy}>전체</button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {CATEGORIES.map(c => (
            <button key={c.id} onClick={() => toggleCategory(c.id)} disabled={busy}
              className={`text-xs px-2 py-1 rounded-full border transition-colors ${categories.has(c.id) ? "bg-blue-100 border-blue-300 text-blue-700" : "bg-white border-gray-200 text-gray-400"}`}>
              {c.emoji} {c.id}
            </button>
          ))}
        </div>
      </div>

      {/* Custom Instructions */}
      <div>
        <label className="text-xs font-medium text-gray-600 block mb-1">사용자 지시사항 (선택)</label>
        <textarea className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 outline-none focus:border-blue-400 bg-white resize-none"
          rows={2} value={customPrompt} onChange={e => setCustomPrompt(e.target.value)}
          placeholder="예: 반드시 모바일 뷰포트 기준으로 테스트해줘" disabled={busy} />
      </div>

      {/* Google Sheet ID (both modes) */}
      <div>
        <label className="text-xs font-medium text-gray-600 block mb-1">Google 시트 ID (선택)</label>
        <input className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 outline-none focus:border-blue-400 bg-white"
          value={sheetId} onChange={e => setSheetId(e.target.value)}
          placeholder="스프레드시트 URL의 /d/.../ 부분" disabled={busy} />
        <p className="text-xs text-gray-400 mt-0.5">생성된 케이스를 시트에 저장하거나 시트에서 불러옵니다</p>
      </div>
    </div>
  );

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

          {/* Mode toggle */}
          <div className="px-4 pt-3 pb-0">
            <div className="flex rounded-lg overflow-hidden border border-gray-200 text-xs font-medium">
              <button onClick={() => setMode("generate")} disabled={busy}
                className={`flex-1 py-2 transition-colors ${mode === "generate" ? "bg-blue-600 text-white" : "bg-white text-gray-500 hover:bg-gray-50"}`}>
                📋 케이스 생성
              </button>
              <button onClick={() => setMode("run")} disabled={busy}
                className={`flex-1 py-2 transition-colors ${mode === "run" ? "bg-blue-600 text-white" : "bg-white text-gray-500 hover:bg-gray-50"}`}>
                ▶ 직접 실행
              </button>
            </div>
          </div>

          {sharedSettings}

          {/* Mode-specific footer controls */}
          <div className="p-4 border-t space-y-2">
            {mode === "generate" ? (
              <>
                <div>
                  <label className="text-xs font-medium text-gray-600 block mb-1">
                    생성할 케이스 수: <span className="text-blue-600">{caseCount}</span>
                  </label>
                  <input type="range" min={5} max={30} step={5} value={caseCount}
                    onChange={e => setCaseCount(Number(e.target.value))}
                    className="w-full accent-blue-500" disabled={busy} />
                  <div className="flex justify-between text-xs text-gray-400"><span>5</span><span>30</span></div>
                </div>
                <button onClick={generate} disabled={busy || enabledCount === 0}
                  className="w-full py-2.5 rounded-lg text-sm font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed bg-blue-600 hover:bg-blue-700 text-white">
                  {generating ? "생성 중..." : "📋 테스트 케이스 생성"}
                </button>
                {testCases.length > 0 && (
                  <button onClick={runFromCases} disabled={busy || enabledCount === 0}
                    className="w-full py-2.5 rounded-lg text-sm font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed bg-emerald-600 hover:bg-emerald-700 text-white">
                    {running ? "실행 중..." : `▶ 생성된 ${testCases.length}개 케이스로 직접 실행`}
                  </button>
                )}
                {sheetId && testCases.length > 0 && (
                  <div className="space-y-1">
                    <button onClick={exportToSheets} disabled={busy}
                      className="w-full py-2 rounded-lg text-xs font-medium border border-green-300 text-green-700 hover:bg-green-50 disabled:opacity-40">
                      {exporting ? "내보내는 중..." : "📤 Google 시트에 내보내기"}
                    </button>
                    <button onClick={importFromSheets} disabled={busy}
                      className="w-full py-2 rounded-lg text-xs font-medium border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40">
                      {importing ? "불러오는 중..." : "📥 Google 시트에서 불러오기"}
                    </button>
                  </div>
                )}
                {sheetId && testCases.length === 0 && (
                  <button onClick={importFromSheets} disabled={busy}
                    className="w-full py-2 rounded-lg text-xs font-medium border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40">
                    {importing ? "불러오는 중..." : "📥 Google 시트에서 불러오기"}
                  </button>
                )}
              </>
            ) : (
              <>
                <div>
                  <label className="text-xs font-medium text-gray-600 block mb-1">
                    최대 스텝 수: <span className="text-blue-600">{maxSteps}</span>
                  </label>
                  <input type="range" min={5} max={100} step={5} value={maxSteps}
                    onChange={e => setMaxSteps(Number(e.target.value))}
                    className="w-full accent-blue-500" disabled={busy} />
                  <div className="flex justify-between text-xs text-gray-400"><span>5</span><span>100</span></div>
                </div>
                {enabledCount > 1 && (
                  <p className="text-xs text-blue-600 text-center">{enabledCount}개 URL 순차 실행</p>
                )}
                <button onClick={startRun} disabled={busy || enabledCount === 0}
                  className="w-full py-2.5 rounded-lg text-sm font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed bg-blue-600 hover:bg-blue-700 text-white">
                  {running ? "실행 중..." : "▶ 테스트 시작"}
                </button>
              </>
            )}
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
          <span className="text-sm font-medium text-gray-700">
            {mode === "generate" ? "생성된 테스트 케이스" : "실행 로그"}
          </span>
          {generating && (
            <span className="flex items-center gap-1.5 text-xs text-blue-600">
              <span className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
              GPT-4o가 테스트 케이스 생성 중...
            </span>
          )}
          {running && (
            <span className="flex items-center gap-1.5 text-xs text-blue-600">
              <span className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
              GPT-4o 비전 인식 + 플래닝 중...
            </span>
          )}
          {mode === "generate" && testCases.length > 0 && (
            <div className="ml-auto flex items-center gap-2">
              <span className="text-xs text-gray-400">{testCases.length}개</span>
              <button onClick={exportCSV}
                className="text-xs px-3 py-1 border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 transition-colors">
                CSV 다운로드
              </button>
            </div>
          )}
          {mode === "run" && runs.length > 0 && !running && (
            <span className="text-xs text-gray-400 ml-auto">{activeRun?.steps.length ?? 0} 스텝</span>
          )}
        </div>

        {/* ── Generate mode ────────────────────────────────── */}
        {mode === "generate" && (
          <div className="flex-1 overflow-y-auto">
            {/* Status messages */}
            {(exportStatus || importStatus) && (
              <div className={`mx-6 mt-4 px-4 py-2 rounded-lg text-sm ${(exportStatus ?? importStatus ?? "").startsWith("✅") ? "bg-green-50 text-green-700 border border-green-200" : "bg-red-50 text-red-700 border border-red-200"}`}>
                {exportStatus ?? importStatus}
              </div>
            )}

            {genError && (
              <div className="mx-6 mt-4 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                {genError}
              </div>
            )}

            {testCases.length === 0 && !generating && !genError && (
              <div className="flex flex-col items-center justify-center h-full text-gray-400 gap-3">
                <div className="text-5xl">📋</div>
                <p className="text-sm">목표와 URL을 설정하고 테스트 케이스를 생성하세요</p>
                <p className="text-xs text-gray-300">실행 없이 케이스만 작성합니다 · Google 시트로 내보낼 수 있습니다</p>
              </div>
            )}

            {generating && (
              <div className="flex flex-col items-center justify-center h-full text-gray-400 gap-3">
                <span className="w-10 h-10 border-4 border-blue-400 border-t-transparent rounded-full animate-spin" />
                <p className="text-sm">GPT-4o가 테스트 케이스를 작성하고 있습니다...</p>
              </div>
            )}

            {testCases.length > 0 && <TestCaseTable testCases={testCases} onUpdate={setTestCases} />}
          </div>
        )}

        {/* ── Run mode ─────────────────────────────────────── */}
        {mode === "run" && (
          <>
            {/* Target tabs + view toggle */}
            <div className="flex items-center border-b bg-white">
              {runs.length > 1 && (
                <div className="flex overflow-x-auto">
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
              {/* Steps / Report toggle — shown once run completes */}
              {activeRun?.result && !running && (
                <div className="ml-auto flex items-center gap-1 px-3 py-1.5">
                  <button onClick={() => setReportView("steps")}
                    className={`px-3 py-1 text-xs rounded-l-lg border transition-colors ${reportView === "steps" ? "bg-blue-600 text-white border-blue-600" : "bg-white text-gray-500 border-gray-200 hover:bg-gray-50"}`}>
                    📋 스텝
                  </button>
                  <button onClick={() => setReportView("report")}
                    className={`px-3 py-1 text-xs rounded-r-lg border-t border-r border-b transition-colors ${reportView === "report" ? "bg-blue-600 text-white border-blue-600" : "bg-white text-gray-500 border-gray-200 hover:bg-gray-50"}`}>
                    📊 리포트 {reports[activeTab ?? ""] ? "" : "생성 중…"}
                  </button>
                </div>
              )}
            </div>

            <div className="flex-1 overflow-y-auto">
              {runs.length === 0 && (
                <div className="flex flex-col items-center justify-center h-full text-gray-400 gap-3">
                  <div className="text-5xl">🤖</div>
                  <p className="text-sm">목표를 입력하고 테스트를 시작하세요</p>
                  <p className="text-xs text-gray-300">GPT-4o 비전+플래닝 · CDP A11y · Playwright 실행 · 검증</p>
                </div>
              )}

              {/* Step list view */}
              {activeRun && reportView === "steps" && (
                <>
                  <div className="divide-y">
                    {activeRun.steps.map(step => (
                      <StepCard key={step.stepNumber} step={step}
                        expanded={expandedStep === step.stepNumber}
                        onToggle={() => setExpandedStep(expandedStep === step.stepNumber ? null : step.stepNumber)}
                      />
                    ))}
                  </div>
                  {running && activeRun.status === "running" && (
                    <div className="p-4 flex items-center gap-3 text-sm text-gray-500">
                      <span className="w-5 h-5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin shrink-0" />
                      화면 분석 중...
                    </div>
                  )}
                  {activeRun.result && !running && (
                    <RunResultOverview run={activeRun} onRerun={() => { setRuns([]); setReports({}); startRun(); }} />
                  )}
                </>
              )}

              {/* Report view */}
              {activeRun && reportView === "report" && (
                activeTab && reports[activeTab]
                  ? <ReportView report={reports[activeTab]} onViewSteps={() => setReportView("steps")} />
                  : <div className="flex flex-col items-center justify-center h-64 text-gray-400 gap-3">
                      <span className="w-8 h-8 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                      <p className="text-sm">AI 리포트 생성 중…</p>
                    </div>
              )}

              {activeRun?.status === "error" && (
                <div className="m-6 p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                  <strong>오류:</strong> {activeRun.error}
                </div>
              )}

              <div ref={bottomRef} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Test Case Table ───────────────────────────────────────────
function TestCaseTable({ testCases, onUpdate }: {
  testCases: TestCase[];
  onUpdate: (cases: TestCase[]) => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);

  const updateStatus = (id: string, status: TestCase["status"]) => {
    onUpdate(testCases.map(tc => tc.id === id ? { ...tc, status } : tc));
  };

  return (
    <div className="divide-y">
      {testCases.map((tc) => (
        <div key={tc.id} className="hover:bg-gray-50 transition-colors">
          <button onClick={() => setExpanded(expanded === tc.id ? null : tc.id)}
            className="w-full px-6 py-3 flex items-start gap-3 text-left">
            <span className="text-xs font-mono text-gray-400 shrink-0 mt-0.5 w-14">{tc.id}</span>
            <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200 shrink-0 mt-0.5">{tc.category}</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm text-gray-800 font-medium leading-snug">{tc.title}</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className={`text-xs px-2 py-0.5 rounded-full ${PRIORITY_COLORS[tc.priority] ?? ""}`}>{tc.priority}</span>
              <StatusBadge status={tc.status} onChange={(s) => updateStatus(tc.id, s)} />
              <svg className={`w-4 h-4 text-gray-400 transition-transform ${expanded === tc.id ? "rotate-180" : ""}`}
                fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </div>
          </button>

          {expanded === tc.id && (
            <div className="px-6 pb-4 space-y-3 bg-gray-50 border-t">
              <div className="pt-3 grid grid-cols-1 gap-3">
                <div>
                  <p className="text-xs font-semibold text-gray-500 mb-1">테스트 스텝</p>
                  <pre className="text-xs text-gray-700 bg-white rounded-lg px-3 py-2 border whitespace-pre-wrap font-sans leading-relaxed">{tc.steps}</pre>
                </div>
                <div>
                  <p className="text-xs font-semibold text-gray-500 mb-1">기대 결과</p>
                  <p className="text-xs text-gray-700 bg-white rounded-lg px-3 py-2 border leading-relaxed">{tc.expectedResult}</p>
                </div>
                {tc.notes && (
                  <div>
                    <p className="text-xs font-semibold text-gray-500 mb-1">노트</p>
                    <p className="text-xs text-gray-500 bg-white rounded-lg px-3 py-2 border">{tc.notes}</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Status Badge (clickable cycle) ───────────────────────────
const STATUS_CYCLE: TestCase["status"][] = ["Not Run", "Pass", "Fail", "Skip"];
const STATUS_COLORS: Record<string, string> = {
  "Not Run": "bg-gray-100 text-gray-500",
  "Pass": "bg-green-100 text-green-700",
  "Fail": "bg-red-100 text-red-700",
  "Skip": "bg-yellow-100 text-yellow-700",
};
function StatusBadge({ status, onChange }: { status: TestCase["status"]; onChange: (s: TestCase["status"]) => void }) {
  const next = () => {
    const idx = STATUS_CYCLE.indexOf(status);
    onChange(STATUS_CYCLE[(idx + 1) % STATUS_CYCLE.length]);
  };
  return (
    <button onClick={(e) => { e.stopPropagation(); next(); }}
      className={`text-xs px-2 py-0.5 rounded-full cursor-pointer hover:opacity-80 transition-opacity ${STATUS_COLORS[status]}`}>
      {status}
    </button>
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

// ─── Run Result Overview ────────────────────────────────────────
function RunResultOverview({ run, onRerun }: { run: TargetRun; onRerun: () => void }) {
  const { result, steps, target } = run;
  if (!result) return null;

  const passCount = steps.filter(s => s.success).length;
  const failCount = steps.filter(s => !s.success).length;
  const passRate = steps.length > 0 ? (passCount / steps.length * 100) : 0;
  const avgStepMs = result.totalDurationMs / Math.max(steps.length, 1);

  const cfg = result.status === "done"
    ? { emoji: "✅", label: "테스트 완료", bg: "bg-green-50", border: "border-green-200", text: "text-green-800", hdr: "bg-green-100" }
    : result.status === "fail"
    ? { emoji: "❌", label: "버그 발견", bg: "bg-red-50", border: "border-red-200", text: "text-red-800", hdr: "bg-red-100" }
    : { emoji: "⏱", label: "최대 스텝 도달", bg: "bg-yellow-50", border: "border-yellow-200", text: "text-yellow-800", hdr: "bg-yellow-100" };

  const failedSteps = steps.filter(s => !s.success);

  return (
    <div className={`m-6 rounded-xl border-2 ${cfg.border} ${cfg.bg} overflow-hidden`}>
      {/* Header */}
      <div className={`px-6 py-4 ${cfg.hdr} flex items-center justify-between`}>
        <div className={`flex items-center gap-3 ${cfg.text}`}>
          <span className="text-3xl">{cfg.emoji}</span>
          <div>
            <h3 className="font-bold text-base">{cfg.label}</h3>
            <p className="text-xs opacity-70 mt-0.5">{target.label} · {target.url}</p>
          </div>
        </div>
        <button onClick={onRerun}
          className="px-4 py-2 bg-white rounded-lg border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors shadow-sm">
          🔄 다시 실행
        </button>
      </div>

      {/* Metrics */}
      <div className="px-6 py-4 grid grid-cols-4 gap-3">
        {[
          { label: "성공률", value: `${passRate.toFixed(0)}%`, sub: `${passCount}/${steps.length} 스텝` },
          { label: "소요 시간", value: `${(result.totalDurationMs / 1000).toFixed(1)}s`, sub: "총 실행 시간" },
          { label: "스텝당 평균", value: `${(avgStepMs / 1000).toFixed(1)}s`, sub: avgStepMs < 15000 ? "⚡ 빠름" : avgStepMs < 25000 ? "보통" : "느림" },
          { label: "실패 스텝", value: String(failCount), sub: failCount === 0 ? "완벽한 실행" : "개선 필요" },
        ].map(m => (
          <div key={m.label} className="bg-white rounded-lg border border-gray-200 px-4 py-3">
            <p className="text-xs text-gray-500 mb-1">{m.label}</p>
            <p className="text-2xl font-bold text-gray-800">{m.value}</p>
            <p className="text-xs text-gray-400 mt-0.5">{m.sub}</p>
          </div>
        ))}
      </div>

      {/* AI Summary */}
      <div className="px-6 pb-4">
        <p className="text-xs font-semibold text-gray-500 mb-1">AI 요약</p>
        <p className="text-sm text-gray-700 bg-white rounded-lg border border-gray-200 px-4 py-3 leading-relaxed">{result.summary}</p>
      </div>

      {/* Failed steps */}
      {failedSteps.length > 0 && (
        <div className="px-6 pb-5">
          <p className="text-xs font-semibold text-red-500 mb-2">실패한 스텝 ({failedSteps.length}개)</p>
          <div className="space-y-1.5">
            {failedSteps.map(s => (
              <div key={s.stepNumber} className="text-xs bg-white rounded-lg border border-red-100 px-3 py-2">
                <span className="font-semibold text-red-600">Step {s.stepNumber}</span>
                <span className="text-gray-500 ml-1">[{s.decision.action}]</span>
                <span className="text-gray-700 ml-1">{s.decision.description}</span>
                {s.error && <div className="text-red-500 mt-0.5 truncate">⚠ {s.error}</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Dashboard save note */}
      <div className="px-6 pb-4">
        <p className="text-xs text-gray-400">✓ 결과가 대시보드에 자동 저장되었습니다</p>
      </div>
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
            <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">🧠 GPT-4o 비전+플래닝 {(step.planningMs / 1000).toFixed(1)}s</span>
            <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">📸 캡처 {(step.perceptionMs / 1000).toFixed(1)}s</span>
          </div>
          {step.perception && (
            <div>
              <p className="text-xs font-medium text-blue-600 mb-1">🧠 GPT-4o 화면 인식</p>
              <p className="text-xs text-gray-600 bg-white rounded px-3 py-2 border leading-relaxed">{step.perception}</p>
            </div>
          )}
          <div>
            <p className="text-xs font-medium text-gray-500 mb-1">판단 근거</p>
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

// ─── Report View ────────────────────────────────────────────────
const RISK_CONFIG: Record<string, { label: string; bg: string; text: string; border: string }> = {
  low:      { label: "낮음",   bg: "bg-green-50",  text: "text-green-700",  border: "border-green-200" },
  medium:   { label: "보통",   bg: "bg-yellow-50", text: "text-yellow-700", border: "border-yellow-200" },
  high:     { label: "높음",   bg: "bg-orange-50", text: "text-orange-700", border: "border-orange-200" },
  critical: { label: "심각",   bg: "bg-red-50",    text: "text-red-700",    border: "border-red-200" },
};
const SEVERITY_CONFIG: Record<string, { label: string; dot: string; text: string }> = {
  critical: { label: "Critical", dot: "bg-red-500",    text: "text-red-700" },
  high:     { label: "High",     dot: "bg-orange-500", text: "text-orange-700" },
  medium:   { label: "Medium",   dot: "bg-yellow-500", text: "text-yellow-700" },
  low:      { label: "Low",      dot: "bg-blue-400",   text: "text-blue-700" },
};
const FINDING_TYPE_ICON: Record<string, string> = { bug: "🐛", warning: "⚠️", info: "ℹ️" };

function ReportView({ report, onViewSteps }: { report: TestReport; onViewSteps: () => void }) {
  const [expandedFinding, setExpandedFinding] = useState<number | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [downloading, setDownloading] = useState<"html" | "json" | null>(null);
  const risk = RISK_CONFIG[report.riskLevel] ?? RISK_CONFIG.medium;
  const statusIcon = report.status === "done" ? "✅" : report.status === "fail" ? "❌" : "⏱";
  const bugs = report.findings.filter(f => f.type === "bug");
  const warnings = report.findings.filter(f => f.type === "warning");

  const saveReport = async () => {
    if (saveState !== "idle") return;
    setSaveState("saving");
    try {
      const res = await fetch("/api/reports/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ report }),
      });
      if (!res.ok) throw new Error("저장 실패");
      setSaveState("saved");
    } catch {
      setSaveState("error");
      setTimeout(() => setSaveState("idle"), 3000);
    }
  };

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

      {/* ── Report Header ─────────────────────────────────── */}
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
              {new Date(report.createdAt).toLocaleString("ko-KR")} · {report.stepCount}스텝 · {(report.totalDurationMs / 1000).toFixed(1)}s
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
              <button
                onClick={saveReport}
                disabled={saveState !== "idle"}
                className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold transition-colors
                  ${saveState === "saved" ? "bg-green-500 text-white cursor-default" :
                    saveState === "error" ? "bg-red-500 text-white" :
                    saveState === "saving" ? "bg-gray-500 text-white" :
                    "bg-white text-gray-800 hover:bg-gray-100"}`}
              >
                {saveState === "saving" ? (
                  <><span className="w-3 h-3 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />저장 중...</>
                ) : saveState === "saved" ? (
                  <>✓ 저장됨</>
                ) : saveState === "error" ? (
                  <>✕ 저장 실패</>
                ) : (
                  <>💾 리포트 저장</>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Metrics bar */}
        <div className="grid grid-cols-4 divide-x bg-white">
          {[
            { label: "성공률", value: `${report.passRate.toFixed(0)}%`, sub: `${Math.round(report.stepCount * report.passRate / 100)}/${report.stepCount} 스텝` },
            { label: "발견된 버그", value: String(bugs.length), sub: bugs.length === 0 ? "발견 없음" : `${bugs.filter(b => b.severity === "critical" || b.severity === "high").length}개 Critical/High` },
            { label: "경고", value: String(warnings.length), sub: "Warning 항목" },
            { label: "테스트 항목", value: String(report.testedFeatures.length), sub: "검증된 기능" },
          ].map(m => (
            <div key={m.label} className="px-5 py-4 text-center">
              <p className="text-2xl font-bold text-gray-800">{m.value}</p>
              <p className="text-xs text-gray-500 mt-0.5">{m.label}</p>
              <p className="text-xs text-gray-400">{m.sub}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ── Executive Summary ─────────────────────────────── */}
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

      {/* ── Findings ──────────────────────────────────────── */}
      {report.findings.length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
          <div className="px-5 py-4 border-b bg-gray-50">
            <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
              <span>🔍</span> 발견사항 ({report.findings.length}건)
            </h3>
          </div>
          <div className="divide-y">
            {report.findings.map((f, idx) => {
              const sev = SEVERITY_CONFIG[f.severity] ?? SEVERITY_CONFIG.medium;
              const expanded = expandedFinding === idx;
              return (
                <div key={idx} className="hover:bg-gray-50 transition-colors">
                  <button onClick={() => setExpandedFinding(expanded ? null : idx)}
                    className="w-full px-5 py-4 flex items-start gap-3 text-left">
                    <span className="text-base shrink-0 mt-0.5">{FINDING_TYPE_ICON[f.type] ?? "•"}</span>
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
                    <div className="px-5 pb-5 space-y-4 bg-gray-50 border-t">
                      {/* Screenshot */}
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
                        {/* Description */}
                        <div>
                          <p className="text-xs font-semibold text-gray-500 mb-1">현상</p>
                          <p className="text-sm text-gray-700 bg-white rounded-lg border px-3 py-2.5 leading-relaxed">{f.description}</p>
                        </div>
                        {/* Root cause */}
                        <div>
                          <p className="text-xs font-semibold text-red-500 mb-1">🔍 근본 원인 분석</p>
                          <p className="text-sm text-gray-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2.5 leading-relaxed">{f.rootCause}</p>
                        </div>
                        {/* Reproduction */}
                        <div>
                          <p className="text-xs font-semibold text-gray-500 mb-1">재현 절차</p>
                          <pre className="text-xs text-gray-700 bg-white rounded-lg border px-3 py-2.5 whitespace-pre-wrap font-sans leading-relaxed">{f.reproductionSteps}</pre>
                        </div>
                        {/* Recommendation */}
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

      {/* ── Recommendations ───────────────────────────────── */}
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

      {/* ── Step screenshots timeline ─────────────────────── */}
      <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
        <div className="px-5 py-4 border-b bg-gray-50 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
            <span>🎞️</span> 스텝별 스크린샷
          </h3>
          <button onClick={onViewSteps} className="text-xs text-blue-600 hover:text-blue-700">전체 스텝 로그 →</button>
        </div>
        <div className="grid grid-cols-3 gap-3 p-4">
          {report.steps.filter(s => s.screenshotPath).map(s => (
            <a key={s.stepNumber} href={s.screenshotPath} target="_blank" rel="noopener noreferrer" className="group relative block">
              <img src={s.screenshotPath} alt={`Step ${s.stepNumber}`}
                className="w-full rounded-lg border object-top object-cover aspect-video group-hover:opacity-90 transition-opacity" />
              <div className={`absolute top-1.5 left-1.5 flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-semibold ${s.success ? "bg-green-600" : "bg-red-600"} text-white`}>
                {s.success ? "✓" : "✗"} {s.stepNumber}
              </div>
              <p className="text-xs text-gray-500 mt-1 truncate">{s.decision.description}</p>
            </a>
          ))}
        </div>
      </div>

    </div>
  );
}
