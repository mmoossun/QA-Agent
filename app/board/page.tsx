"use client";
import { useEffect, useState, useCallback, useRef, useTransition } from "react";

// ─── Types ────────────────────────────────────────────────────
type Priority  = "critical" | "high" | "medium" | "low";
type Status    = "todo" | "in_progress" | "in_review" | "done" | "wont_fix";
type IssueType = "bug" | "task" | "story" | "improvement" | "spec";
type LinkType  = "blocks" | "duplicates" | "relates";
type View      = "board" | "backlog";

interface Comment    { id: string; content: string; authorName: string; createdAt: string; kind: "comment"; }
interface HistEntry  { id: string; field: string; oldValue?: string; newValue?: string; createdAt: string; kind: "history"; }
type Activity = Comment | HistEntry;

interface Sprint { id: string; name: string; goal?: string; status: string; startDate?: string; endDate?: string; _count?: { issues: number }; }
interface IssueLink { id: string; linkType: LinkType; from: IssueMin; to: IssueMin; }
interface IssueMin  { id: string; issueKey?: string; title: string; status: string; priority: string; }

interface Issue {
  id: string; issueKey?: string; title: string; description?: string;
  type: IssueType; priority: Priority; status: Status; source: string;
  assignee?: string; reporter?: string; epicName?: string; storyPoints?: number;
  screenshotUrl?: string; targetUrl?: string; environment?: string;
  stepToReproduce?: string; expectedResult?: string; actualResult?: string;
  tags: string[]; dueDate?: string; resolvedAt?: string; sprintId?: string;
  createdAt: string; updatedAt: string;
  _count: { comments: number };
}
interface ShareLink { id: string; publicToken: string; label?: string; viewCount: number; createdAt: string; }
interface Board {
  id: string; name: string; description?: string; targetUrl?: string;
  boardKey: string; issueCounter: number; wipLimits?: string;
  figmaFileKey?: string; figmaFileUrl?: string;
  githubOwner?: string; githubRepo?: string; hasGithubToken?: boolean;
  createdAt: string; _count: { issues: number }; shareLinks: ShareLink[];
}
interface Finding { title: string; description: string; severity: string; rootCause: string; reproductionSteps: string; recommendation: string; screenshotPath?: string; }
interface SavedReport { id: string; name: string; targetUrl: string; riskLevel: string; passRate: number; savedAt: string; findingCount: number; findings: Finding[]; }

// ─── Config ───────────────────────────────────────────────────
const PRI: Record<Priority, { label: string; icon: string; color: string; bg: string; ring: string }> = {
  critical: { label: "Critical", icon: "⛔", color: "text-red-700",    bg: "bg-red-50",    ring: "ring-red-200"    },
  high:     { label: "High",     icon: "🔴", color: "text-orange-700", bg: "bg-orange-50", ring: "ring-orange-200" },
  medium:   { label: "Medium",   icon: "🟡", color: "text-yellow-700", bg: "bg-yellow-50", ring: "ring-yellow-200" },
  low:      { label: "Low",      icon: "🔵", color: "text-blue-600",   bg: "bg-blue-50",   ring: "ring-blue-200"   },
};
const TYPE: Record<IssueType, { label: string; icon: string; color: string }> = {
  bug:         { label: "버그",  icon: "🐛", color: "text-red-500"    },
  task:        { label: "작업",  icon: "✅", color: "text-blue-500"   },
  story:       { label: "스토리",icon: "📖", color: "text-purple-500" },
  improvement: { label: "개선",  icon: "⚡", color: "text-yellow-500" },
  spec:        { label: "스펙",  icon: "📋", color: "text-gray-500"   },
};
const ST: Record<Status, { label: string; color: string; headerBg: string }> = {
  todo:        { label: "할 일",      color: "bg-slate-100 text-slate-600",   headerBg: "bg-slate-50  border-slate-200" },
  in_progress: { label: "진행 중",    color: "bg-blue-100 text-blue-700",     headerBg: "bg-blue-50   border-blue-200"  },
  in_review:   { label: "검토 중",    color: "bg-violet-100 text-violet-700", headerBg: "bg-violet-50 border-violet-200"},
  done:        { label: "완료",       color: "bg-green-100 text-green-700",   headerBg: "bg-green-50  border-green-200" },
  wont_fix:    { label: "해결 안 함", color: "bg-gray-100 text-gray-500",     headerBg: "bg-gray-50   border-gray-200"  },
};
const LINK_LABELS: Record<LinkType, string> = { blocks: "차단", duplicates: "중복", relates: "관련" };
const MAIN_COLS: Status[] = ["todo", "in_progress", "in_review", "done"];
const ALL_COLS:  Status[] = [...MAIN_COLS, "wont_fix"];

function av(name?: string) { return name?.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2) ?? "?"; }
function rt(iso: string) {
  const d = Date.now() - new Date(iso).getTime(), m = Math.floor(d / 60000);
  if (m < 1) return "방금"; if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}시간 전`;
  return `${Math.floor(h / 24)}일 전`;
}
function isOverdue(due?: string) { return due && new Date(due) < new Date() && true; }
function fmtDate(iso?: string) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("ko-KR", { month: "short", day: "numeric" });
}
function parseJSON<T>(s?: string | null, fallback: T = [] as unknown as T): T {
  if (!s) return fallback; try { return JSON.parse(s) as T; } catch { return fallback; }
}

// ─── API helpers ──────────────────────────────────────────────
const j = (url: string, opts?: RequestInit) => fetch(url, opts).then(r => r.json());
const jpost  = (url: string, b: unknown) => j(url, { method: "POST",  headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) });
const jpatch = (url: string, b: unknown) => j(url, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) });
const jdel   = (url: string)             => fetch(url, { method: "DELETE" });

// ─── Main ─────────────────────────────────────────────────────
type Modal = "create-board" | "create-issue" | "import" | "share" | "sprint" | "board-settings" | null;

export default function BoardPage() {
  const [boards,  setBoards]  = useState<Board[]>([]);
  const [active,  setActive]  = useState<Board | null>(null);
  const [issues,  setIssues]  = useState<Issue[]>([]);
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [activeSprint, setActiveSprint] = useState<Sprint | null>(null);
  const [view,  setView]  = useState<View>("board");
  const [modal, setModal] = useState<Modal>(null);
  const [detail, setDetail] = useState<Issue | null>(null);
  const [loading, setLoading] = useState(true);

  // Filters
  const [search, setSearch]       = useState("");
  const [priF,   setPriF]         = useState<Priority | "all">("all");
  const [typeF,  setTypeF]        = useState<IssueType | "all">("all");
  const [assignF, setAssignF]     = useState("all");
  const [qf,     setQf]           = useState<Set<string>>(new Set()); // quick filters
  const [swimlane, setSwimlane]   = useState(false);

  // Bulk select
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // DnD
  const [dragging, setDragging] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<Status | null>(null);

  const [, startT] = useTransition();

  const loadBoards = useCallback(async () => {
    const d = await j("/api/boards");
    setBoards(d.boards ?? []); setLoading(false);
    return d.boards as Board[];
  }, []);

  const loadIssues = useCallback(async (bid: string) => {
    const d = await j(`/api/boards/${bid}/issues`);
    setIssues((d.issues ?? []).map((i: Issue) => ({ ...i, tags: parseJSON<string[]>(i.tags as unknown as string, []) })));
  }, []);

  const loadSprints = useCallback(async (bid: string) => {
    const d = await j(`/api/boards/${bid}/sprints`);
    const sp: Sprint[] = d.sprints ?? [];
    setSprints(sp);
    setActiveSprint(sp.find(s => s.status === "active") ?? null);
  }, []);

  useEffect(() => { loadBoards(); }, [loadBoards]);
  useEffect(() => {
    if (!active) return;
    loadIssues(active.id);
    loadSprints(active.id);

    // SSE 실시간 구독 (폴링 대체)
    let es: EventSource | null = null;
    try {
      es = new EventSource(`/api/boards/${active.id}/events`);
      es.addEventListener("issue_created", () => loadIssues(active.id));
      es.addEventListener("issue_updated", () => loadIssues(active.id));
      es.addEventListener("issue_deleted", () => loadIssues(active.id));
      es.onerror = () => es?.close();
    } catch { /* SSE not supported */ }

    // SSE 실패 대비 폴링 fallback (60초)
    const t = setInterval(() => loadIssues(active.id), 60_000);
    return () => { clearInterval(t); es?.close(); };
  }, [active, loadIssues, loadSprints]);

  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setDetail(null); setModal(null); setSelected(new Set()); }
      if ((e.key === "c" || e.key === "C") && !e.ctrlKey && !e.metaKey && !detail && !modal) setModal("create-issue");
    };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, [detail, modal]);

  // Filtered issues
  const today = new Date();
  const filtered = issues.filter(i => {
    if (priF !== "all" && i.priority !== priF) return false;
    if (typeF !== "all" && i.type !== typeF) return false;
    if (assignF !== "all" && i.assignee !== assignF) return false;
    if (qf.has("overdue") && !(i.dueDate && new Date(i.dueDate) < today && i.status !== "done")) return false;
    if (qf.has("unassigned") && i.assignee) return false;
    if (qf.has("highplus") && !["critical", "high"].includes(i.priority)) return false;
    if (qf.has("sprint") && i.sprintId !== activeSprint?.id) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!i.title.toLowerCase().includes(q) && !i.issueKey?.toLowerCase().includes(q) && !i.description?.toLowerCase().includes(q) && !i.epicName?.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const byStatus = (s: Status) => filtered.filter(i => i.status === s);
  const wipLimits = parseJSON<Record<string, number>>(active?.wipLimits, {});
  const assignees = Array.from(new Set(issues.map(i => i.assignee).filter(Boolean) as string[]));
  const epics     = Array.from(new Set(issues.map(i => i.epicName).filter(Boolean) as string[]));

  const stats = {
    total: issues.length,
    done: issues.filter(i => i.status === "done").length,
    inProg: issues.filter(i => i.status === "in_progress").length,
    overdue: issues.filter(i => isOverdue(i.dueDate) && i.status !== "done").length,
    rate: issues.length > 0 ? Math.round(issues.filter(i => i.status === "done").length / issues.length * 100) : 0,
    pts: issues.filter(i => i.status === "done").reduce((s, i) => s + (i.storyPoints ?? 0), 0),
  };

  // Status change (with optimistic update)
  const changeStatus = useCallback(async (issue: Issue, status: Status) => {
    startT(() => setIssues(p => p.map(i => i.id === issue.id ? { ...i, status } : i)));
    if (detail?.id === issue.id) setDetail(p => p ? { ...p, status } : null);
    await jpatch(`/api/boards/${active!.id}/issues/${issue.id}`, { status });
    loadIssues(active!.id);
  }, [active, detail, loadIssues]);

  // DnD handlers
  const onDragStart = (issueId: string) => setDragging(issueId);
  const onDragEnd   = () => { setDragging(null); setDragOver(null); };
  const onDrop      = async (status: Status) => {
    if (!dragging || !active) return;
    const issue = issues.find(i => i.id === dragging);
    if (issue && issue.status !== status) await changeStatus(issue, status);
    setDragging(null); setDragOver(null);
  };

  // Bulk operations
  const bulkChange = async (field: string, value: string) => {
    await Promise.all(Array.from(selected).map(id =>
      jpatch(`/api/boards/${active!.id}/issues/${id}`, { [field]: value })
    ));
    await loadIssues(active!.id);
    setSelected(new Set());
  };

  const handleDelete = async (issue: Issue) => {
    if (!confirm(`"${issue.title}" 삭제할까요?`)) return;
    setDetail(null); setIssues(p => p.filter(i => i.id !== issue.id));
    await jdel(`/api/boards/${active!.id}/issues/${issue.id}`);
  };

  const handleCopyLink = async (token: string) => {
    await navigator.clipboard.writeText(`${window.location.origin}/share/${token}`).catch(() => {});
  };

  const toggleSelect = (id: string) => setSelected(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleQf = (k: string) => setQf(p => { const n = new Set(p); n.has(k) ? n.delete(k) : n.add(k); return n; });

  return (
    <div className="flex h-[calc(100vh-49px)] bg-[#F4F5F7] overflow-hidden select-none">

      {/* ── Sidebar ── */}
      <aside className="w-52 bg-[#0052CC] flex flex-col shrink-0 overflow-y-auto">
        <div className="px-3 py-4 border-b border-blue-600">
          <p className="text-blue-200 text-[10px] font-bold uppercase tracking-widest mb-2">내 보드</p>
          {loading ? <p className="text-blue-300 text-xs">로딩 중...</p> :
            boards.length === 0 ? <p className="text-blue-300 text-xs">보드 없음</p> :
            boards.map(b => (
              <button key={b.id} onClick={() => { setActive(b); setDetail(null); setSearch(""); setSelected(new Set()); }}
                className={`w-full text-left px-2.5 py-2 rounded-lg text-xs transition-all mb-0.5 ${active?.id === b.id ? "bg-white text-[#0052CC] font-bold" : "text-white hover:bg-blue-600"}`}>
                <div className="flex items-center gap-1.5">
                  <span className={`text-[10px] font-mono font-black px-1 py-0.5 rounded ${active?.id === b.id ? "bg-blue-100 text-[#0052CC]" : "bg-blue-500 text-white"}`}>{b.boardKey}</span>
                  <span className="truncate">{b.name}</span>
                </div>
                <p className={`text-[10px] mt-0.5 ${active?.id === b.id ? "text-blue-400" : "text-blue-300"}`}>{b._count.issues}개 이슈</p>
              </button>
            ))
          }
        </div>
        <div className="p-3 mt-auto">
          <button onClick={() => setModal("create-board")}
            className="w-full text-xs font-bold bg-white text-[#0052CC] py-2 rounded-lg hover:bg-blue-50">
            + 새 보드
          </button>
        </div>
      </aside>

      {/* ── Main ── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {!active ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-5 text-gray-400">
            <div className="text-7xl">📋</div>
            <div className="text-center">
              <h2 className="text-xl font-bold text-gray-600 mb-1">보드를 선택하거나 새로 만드세요</h2>
              <p className="text-sm">이슈를 생성하고 스프린트를 관리하며 팀과 공유하세요</p>
            </div>
            <button onClick={() => setModal("create-board")}
              className="px-6 py-2.5 bg-[#0052CC] text-white font-bold rounded-xl hover:bg-blue-700 text-sm">
              + 새 보드 만들기
            </button>
          </div>
        ) : (<>
          {/* ── Project header ── */}
          <div className="bg-white border-b px-5 py-2.5 flex items-center gap-3 shrink-0">
            <div className="w-7 h-7 bg-[#0052CC] rounded-lg flex items-center justify-center text-white text-[10px] font-black shrink-0">{active.boardKey.slice(0,2)}</div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="text-sm font-bold text-gray-800 truncate">{active.name}</h1>
                {activeSprint && (
                  <span className="text-[10px] bg-green-100 text-green-700 font-bold px-2 py-0.5 rounded-full whitespace-nowrap">
                    🏃 {activeSprint.name}
                    {activeSprint.endDate && ` · ${fmtDate(activeSprint.endDate)} 마감`}
                  </span>
                )}
              </div>
            </div>
            {/* Stats chips */}
            <div className="hidden lg:flex items-center gap-3 text-center shrink-0">
              {stats.overdue > 0 && <div className="bg-red-50 border border-red-200 px-2.5 py-1 rounded-lg"><p className="text-sm font-black text-red-600">{stats.overdue}</p><p className="text-[10px] text-red-400">기한초과</p></div>}
              <div><p className="text-lg font-black text-gray-800 leading-none">{stats.total}</p><p className="text-[10px] text-gray-400">전체</p></div>
              <div><p className="text-lg font-black text-green-600 leading-none">{stats.rate}%</p><p className="text-[10px] text-gray-400">완료율</p></div>
              {stats.pts > 0 && <div><p className="text-lg font-black text-purple-600 leading-none">{stats.pts}</p><p className="text-[10px] text-gray-400">완료 포인트</p></div>}
            </div>
            {/* Actions */}
            <div className="flex gap-1.5 shrink-0">
              <button onClick={() => setModal("sprint")} className="text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50">🏃 스프린트</button>
              <button onClick={() => setModal("board-settings")}
                className={`text-xs font-semibold px-2.5 py-1.5 rounded-lg border transition-colors ${active.figmaFileKey || active.hasGithubToken ? "border-purple-300 bg-purple-50 text-purple-700" : "border-gray-200 text-gray-600 hover:bg-gray-50"}`}
                title="Figma / GitHub 연동 설정">
                ⚙ 연동 설정{(active.figmaFileKey || active.hasGithubToken) ? " ✓" : ""}
              </button>
              <button onClick={() => setModal("import")} className="text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50">AI 가져오기</button>
              <button onClick={() => setModal("share")}  className="text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50">🔗 공유</button>
              <button onClick={() => setModal("create-issue")} className="text-xs font-bold px-3 py-1.5 rounded-lg bg-[#0052CC] text-white hover:bg-blue-700">+ 이슈</button>
            </div>
          </div>

          {/* ── Tabs + filters ── */}
          <div className="bg-white border-b px-5 flex items-center gap-1 shrink-0 flex-wrap">
            {(["board", "backlog"] as View[]).map(v => (
              <button key={v} onClick={() => setView(v)}
                className={`text-xs font-bold py-2.5 px-3 border-b-2 transition-all ${view === v ? "border-[#0052CC] text-[#0052CC]" : "border-transparent text-gray-500 hover:text-gray-700"}`}>
                {v === "board" ? "🗂 보드" : "📃 백로그"}
              </button>
            ))}
            <div className="w-px h-4 bg-gray-200 mx-1" />
            {/* Quick filters */}
            {[
              { k: "sprint", label: `🏃 스프린트`, disabled: !activeSprint },
              { k: "overdue",    label: `⏰ 기한초과 ${stats.overdue > 0 ? stats.overdue : ""}` },
              { k: "unassigned", label: "👤 미배정" },
              { k: "highplus",   label: "🔴 High+" },
            ].map(({ k, label, disabled }) => (
              <button key={k} onClick={() => !disabled && toggleQf(k)} disabled={!!disabled}
                className={`text-[10px] font-bold px-2 py-1 rounded-full transition-all ${disabled ? "opacity-30 cursor-default" : qf.has(k) ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>
                {label}
              </button>
            ))}
            <div className="ml-auto flex items-center gap-1.5 py-1.5 flex-wrap">
              <div className="relative">
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="이슈 검색... (C)" title="단축키: C"
                  className="text-xs border border-gray-200 rounded-lg pl-6 pr-3 py-1.5 w-36 focus:outline-none focus:ring-2 focus:ring-blue-300" />
                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 text-[10px]">🔍</span>
                {search && <button onClick={() => setSearch("")} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-400 text-[10px] hover:text-gray-600">✕</button>}
              </div>
              <select value={priF} onChange={e => setPriF(e.target.value as Priority | "all")}
                className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 text-gray-600 focus:outline-none">
                <option value="all">우선순위</option>
                {(Object.keys(PRI) as Priority[]).map(p => <option key={p} value={p}>{PRI[p].icon} {PRI[p].label}</option>)}
              </select>
              <select value={typeF} onChange={e => setTypeF(e.target.value as IssueType | "all")}
                className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 text-gray-600 focus:outline-none">
                <option value="all">유형</option>
                {(Object.keys(TYPE) as IssueType[]).map(t => <option key={t} value={t}>{TYPE[t].icon} {TYPE[t].label}</option>)}
              </select>
              {assignees.length > 0 && (
                <select value={assignF} onChange={e => setAssignF(e.target.value)}
                  className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 text-gray-600 focus:outline-none">
                  <option value="all">담당자</option>
                  {assignees.map(a => <option key={a} value={a}>{a}</option>)}
                </select>
              )}
              {/* Swimlane toggle */}
              {view === "board" && (
                <button onClick={() => setSwimlane(p => !p)}
                  className={`text-[10px] font-bold px-2 py-1.5 rounded-lg border transition-all ${swimlane ? "border-blue-400 bg-blue-50 text-blue-600" : "border-gray-200 text-gray-500 hover:border-gray-300"}`}>
                  〓 수영레인
                </button>
              )}
              <span className="text-[10px] text-gray-400">{filtered.length}개</span>
            </div>
          </div>

          {/* ── Views ── */}
          <div className="flex-1 overflow-hidden relative">
            {view === "board"
              ? <KanbanView issues={filtered} wipLimits={wipLimits} swimlane={swimlane} assignees={assignees}
                  selected={selected} dragging={dragging} dragOver={dragOver}
                  onDetail={setDetail} onStatusChange={changeStatus} onCreateIssue={() => setModal("create-issue")}
                  onSelect={toggleSelect} onDragStart={onDragStart} onDragEnd={onDragEnd}
                  onDragOver={setDragOver} onDrop={onDrop} />
              : <BacklogView issues={filtered} sprints={sprints} activeSprint={activeSprint}
                  selected={selected} onDetail={setDetail} onStatusChange={changeStatus}
                  onSelect={toggleSelect} onSprintAssign={async (id, sprintId) => {
                    await jpatch(`/api/boards/${active!.id}/issues/${id}`, { sprintId });
                    loadIssues(active!.id);
                  }} />
            }
          </div>

          {/* ── Bulk action bar ── */}
          {selected.size > 0 && (
            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-40 bg-gray-900 text-white rounded-2xl shadow-2xl px-5 py-3 flex items-center gap-4">
              <span className="text-sm font-bold">{selected.size}개 선택됨</span>
              <div className="w-px h-4 bg-gray-600" />
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400">상태 변경:</span>
                {MAIN_COLS.map(s => (
                  <button key={s} onClick={() => bulkChange("status", s)}
                    className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-gray-700 hover:bg-gray-600 transition-colors">
                    {ST[s].label}
                  </button>
                ))}
              </div>
              {assignees.length > 0 && <>
                <div className="w-px h-4 bg-gray-600" />
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-400">담당자:</span>
                  {assignees.slice(0, 3).map(a => (
                    <button key={a} onClick={() => bulkChange("assignee", a)}
                      className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-gray-700 hover:bg-gray-600 transition-colors">
                      {a}
                    </button>
                  ))}
                </div>
              </>}
              <div className="w-px h-4 bg-gray-600" />
              <button onClick={() => setSelected(new Set())} className="text-xs text-gray-400 hover:text-white">✕ 해제</button>
            </div>
          )}
        </>)}
      </div>

      {/* ── Detail Panel ── */}
      {detail && active && (
        <DetailPanel issue={detail} boardId={active.id} allIssues={issues}
          onClose={() => setDetail(null)}
          onStatusChange={s => changeStatus(detail, s)}
          onDelete={() => handleDelete(detail)}
          onUpdate={async d => { await jpatch(`/api/boards/${active.id}/issues/${detail.id}`, d); await loadIssues(active.id); setDetail(p => p ? { ...p, ...d } : null); }}
        />
      )}

      {/* ── Modals ── */}
      {modal === "create-board" && <CreateBoardModal onClose={() => setModal(null)} onCreated={async b => { const fresh = await loadBoards(); setActive(fresh.find(f => f.id === b.id) ?? b); setModal(null); }} />}
      {modal === "create-issue" && active && <CreateIssueModal boardId={active.id} sprints={sprints} epics={epics} onClose={() => setModal(null)} onCreated={async () => { await loadIssues(active.id); setModal(null); }} />}
      {modal === "import" && active && <ImportModal boardId={active.id} onClose={() => setModal(null)} onImported={async () => { await loadIssues(active.id); setModal(null); }} />}
      {modal === "share" && active && <ShareModal board={active} onCopy={handleCopyLink} onCreated={loadBoards} onClose={() => setModal(null)} />}
      {modal === "sprint" && active && <SprintModal boardId={active.id} sprints={sprints} onClose={() => setModal(null)} onChanged={async () => { await loadSprints(active.id); setModal(null); }} />}
      {modal === "board-settings" && active && <BoardSettingsModal board={active} onClose={() => setModal(null)} onSaved={async () => { const fresh = await loadBoards(); setActive(fresh.find(b => b.id === active.id) ?? active); setModal(null); }} />}
    </div>
  );
}

// ─── Kanban View ──────────────────────────────────────────────
function KanbanView({ issues, wipLimits, swimlane, assignees, selected, dragging, dragOver, onDetail, onStatusChange, onCreateIssue, onSelect, onDragStart, onDragEnd, onDragOver, onDrop }: {
  issues: Issue[]; wipLimits: Record<string, number>; swimlane: boolean; assignees: string[];
  selected: Set<string>; dragging: string | null; dragOver: Status | null;
  onDetail: (i: Issue) => void; onStatusChange: (i: Issue, s: Status) => void;
  onCreateIssue: () => void; onSelect: (id: string) => void;
  onDragStart: (id: string) => void; onDragEnd: () => void;
  onDragOver: (s: Status) => void; onDrop: (s: Status) => void;
}) {
  const cols = MAIN_COLS;
  const wontFix = issues.filter(i => i.status === "wont_fix");

  return (
    <div className="h-full overflow-x-auto p-3 flex gap-3">
      {cols.map(status => {
        const col = issues.filter(i => i.status === status);
        const wip = wipLimits[status];
        const overWip = wip && col.length > wip;
        const groups = swimlane
          ? (assignees.length > 0 ? assignees : ["미배정"]).map(a => ({ name: a, items: col.filter(i => (i.assignee ?? "미배정") === a) })).filter(g => g.items.length > 0)
          : [{ name: "", items: col }];

        return (
          <div key={status}
            className={`flex flex-col w-[272px] shrink-0 rounded-xl transition-all ${dragOver === status ? "ring-2 ring-blue-400 ring-offset-2" : ""}`}
            onDragOver={e => { e.preventDefault(); onDragOver(status); }}
            onDrop={e => { e.preventDefault(); onDrop(status); }}>
            {/* Column header */}
            <div className={`flex items-center gap-2 px-3 py-2 rounded-t-xl border ${ST[status].headerBg} mb-1`}>
              <span className="text-xs font-black text-gray-700 uppercase tracking-wide">{ST[status].label}</span>
              <span className={`text-xs font-black px-2 py-0.5 rounded-full ${overWip ? "bg-red-500 text-white" : "bg-white text-gray-600"}`}>
                {col.length}{wip ? `/${wip}` : ""}
              </span>
              {overWip && <span className="text-[10px] text-red-600 font-bold ml-auto">⚠ WIP 초과</span>}
              {/* Progress mini-bar */}
              <div className="ml-auto w-12 h-1 bg-gray-200 rounded-full overflow-hidden">
                <div className="h-full bg-blue-500 rounded-full" style={{ width: `${Math.min(col.length / (Math.max(...MAIN_COLS.map(s => issues.filter(i => i.status === s).length), 1)) * 100, 100)}%` }} />
              </div>
            </div>
            {/* Cards */}
            <div className="flex-1 overflow-y-auto space-y-1.5 px-0.5">
              {groups.map(g => (
                <div key={g.name}>
                  {swimlane && g.name && (
                    <div className="flex items-center gap-2 py-1 px-1">
                      <div className="w-5 h-5 bg-[#0052CC] rounded-full flex items-center justify-center text-white text-[9px] font-black">{av(g.name)}</div>
                      <span className="text-xs font-bold text-gray-500">{g.name}</span>
                      <span className="text-[10px] text-gray-400">{g.items.length}</span>
                    </div>
                  )}
                  {g.items.map(issue => (
                    <IssueCard key={issue.id} issue={issue} selected={selected.has(issue.id)} dragging={dragging === issue.id}
                      onClick={() => onDetail(issue)} onSelect={() => onSelect(issue.id)}
                      onStatusChange={s => onStatusChange(issue, s)}
                      onDragStart={() => onDragStart(issue.id)} onDragEnd={onDragEnd} />
                  ))}
                </div>
              ))}
              {status === "todo" && (
                <button onClick={onCreateIssue}
                  className="w-full text-xs text-gray-400 hover:text-[#0052CC] border border-dashed border-gray-200 hover:border-blue-300 rounded-xl py-2.5 transition-colors bg-white mt-1">
                  + 이슈 추가
                </button>
              )}
            </div>
          </div>
        );
      })}
      {/* Won't Fix mini column */}
      <div className="flex flex-col w-12 shrink-0">
        <div className={`flex-1 rounded-xl border ${ST.wont_fix.headerBg} flex flex-col items-center py-3 gap-2`}
          onDragOver={e => { e.preventDefault(); onDragOver("wont_fix"); }}
          onDrop={e => { e.preventDefault(); onDrop("wont_fix"); }}>
          <span className="text-[10px] font-black text-gray-400 [writing-mode:vertical-lr] rotate-180">Won&apos;t Fix</span>
          <span className="text-xs font-black text-gray-400 bg-white rounded-full w-6 h-6 flex items-center justify-center">{wontFix.length}</span>
        </div>
      </div>
    </div>
  );
}

// ─── Issue Card ───────────────────────────────────────────────
function IssueCard({ issue, selected, dragging, onClick, onSelect, onStatusChange, onDragStart, onDragEnd }: {
  issue: Issue; selected: boolean; dragging: boolean;
  onClick: () => void; onSelect: () => void; onStatusChange: (s: Status) => void;
  onDragStart: () => void; onDragEnd: () => void;
}) {
  const pri = PRI[issue.priority];
  const ty  = TYPE[issue.type];
  const overdue = isOverdue(issue.dueDate) && issue.status !== "done";
  const nextMap: Partial<Record<Status, Status>> = { todo: "in_progress", in_progress: "in_review", in_review: "done" };
  const next = nextMap[issue.status];

  return (
    <div
      draggable
      onDragStart={e => { e.dataTransfer.effectAllowed = "move"; onDragStart(); }}
      onDragEnd={onDragEnd}
      className={`bg-white border rounded-xl p-3 transition-all cursor-pointer group
        ${selected ? "border-blue-400 ring-2 ring-blue-200 shadow-md" : "border-gray-200 hover:border-blue-300 hover:shadow-md"}
        ${dragging ? "opacity-40 rotate-2 scale-95" : ""}
      `}>
      {/* Row 1: select + key + type + priority */}
      <div className="flex items-center gap-1.5 mb-2">
        <button onClick={e => { e.stopPropagation(); onSelect(); }}
          className={`w-3.5 h-3.5 rounded border flex items-center justify-center text-[8px] transition-all shrink-0 ${selected ? "bg-blue-600 border-blue-600 text-white" : "border-gray-300 text-transparent hover:border-blue-400"}`}>
          ✓
        </button>
        <span className="font-mono text-[10px] text-[#0052CC] font-bold">{issue.issueKey ?? "—"}</span>
        <span className={`text-[10px] ${ty.color}`}>{ty.icon}</span>
        <span className={`ml-auto inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full ${pri.bg} ${pri.color}`}>
          {pri.icon} {pri.label}
        </span>
      </div>
      {/* Title */}
      <p className="text-xs font-semibold text-gray-800 leading-snug line-clamp-2 mb-2" onClick={onClick}>{issue.title}</p>
      {/* Epic + Story points */}
      {(issue.epicName || issue.storyPoints) && (
        <div className="flex items-center gap-1.5 mb-2">
          {issue.epicName && <span className="text-[10px] bg-purple-100 text-purple-700 font-semibold px-1.5 py-0.5 rounded-full max-w-[100px] truncate">{issue.epicName}</span>}
          {issue.storyPoints != null && <span className="text-[10px] bg-gray-100 text-gray-600 font-bold px-1.5 py-0.5 rounded-full ml-auto">{issue.storyPoints} pt</span>}
        </div>
      )}
      {/* Screenshot */}
      {issue.screenshotUrl && (
        <div className="mb-2 rounded-lg overflow-hidden border border-gray-100" onClick={onClick}>
          <img src={issue.screenshotUrl} alt="" className="w-full h-16 object-cover object-top" />
        </div>
      )}
      {/* Footer */}
      <div className="flex items-center gap-1.5" onClick={onClick}>
        {issue.assignee
          ? <div className="flex items-center gap-1"><div className="w-4 h-4 bg-[#0052CC] rounded-full flex items-center justify-center text-white text-[8px] font-black">{av(issue.assignee)}</div><span className="text-[10px] text-gray-500 max-w-[60px] truncate">{issue.assignee}</span></div>
          : <span className="text-[10px] text-gray-400">미배정</span>
        }
        <span className="text-[10px] text-gray-400 ml-auto">{rt(issue.createdAt)}</span>
        {issue._count.comments > 0 && <span className="text-[10px] text-gray-400">💬{issue._count.comments}</span>}
        {overdue && <span className="text-[10px] bg-red-100 text-red-600 font-bold px-1 py-0.5 rounded">⏰ {fmtDate(issue.dueDate)}</span>}
        {issue.dueDate && !overdue && issue.status !== "done" && <span className="text-[10px] text-gray-400">{fmtDate(issue.dueDate)}</span>}
      </div>
      {/* Quick advance button */}
      {next && (
        <button onClick={e => { e.stopPropagation(); onStatusChange(next); }}
          className="mt-2 w-full text-[10px] text-[#0052CC] opacity-0 group-hover:opacity-100 font-bold hover:bg-blue-50 rounded-lg py-1 transition-all">
          → {ST[next].label}
        </button>
      )}
    </div>
  );
}

// ─── Backlog View ─────────────────────────────────────────────
function BacklogView({ issues, sprints, activeSprint, selected, onDetail, onStatusChange, onSelect, onSprintAssign }: {
  issues: Issue[]; sprints: Sprint[]; activeSprint: Sprint | null;
  selected: Set<string>; onDetail: (i: Issue) => void;
  onStatusChange: (i: Issue, s: Status) => void;
  onSelect: (id: string) => void;
  onSprintAssign: (issueId: string, sprintId: string | null) => void;
}) {
  const sorted = [...issues].sort((a, b) => {
    const p = { critical: 0, high: 1, medium: 2, low: 3 };
    if (p[a.priority] !== p[b.priority]) return p[a.priority] - p[b.priority];
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  return (
    <div className="h-full overflow-y-auto p-3">
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {sorted.length === 0
          ? <div className="py-20 text-center text-gray-400"><p className="text-4xl mb-3">📭</p><p className="font-semibold">이슈가 없습니다</p></div>
          : <table className="w-full text-xs">
              <thead>
                <tr className="bg-gray-50 border-b">
                  <th className="px-3 py-2 w-6"><input type="checkbox" className="accent-blue-600" /></th>
                  <th className="px-3 py-2 text-left font-bold text-gray-500 uppercase w-20">키</th>
                  <th className="px-3 py-2 text-left font-bold text-gray-500 uppercase">제목</th>
                  <th className="px-3 py-2 text-left font-bold text-gray-500 uppercase w-24">상태</th>
                  <th className="px-3 py-2 text-left font-bold text-gray-500 uppercase w-20">우선순위</th>
                  <th className="px-3 py-2 text-left font-bold text-gray-500 uppercase w-20">담당자</th>
                  <th className="px-3 py-2 text-left font-bold text-gray-500 uppercase w-10">SP</th>
                  <th className="px-3 py-2 text-left font-bold text-gray-500 uppercase w-24">기한</th>
                  {sprints.length > 0 && <th className="px-3 py-2 text-left font-bold text-gray-500 uppercase w-28">스프린트</th>}
                </tr>
              </thead>
              <tbody>
                {sorted.map(issue => {
                  const pri = PRI[issue.priority]; const ty = TYPE[issue.type]; const overdue = isOverdue(issue.dueDate) && issue.status !== "done";
                  return (
                    <tr key={issue.id} className={`border-b last:border-0 hover:bg-blue-50 cursor-pointer transition-colors ${selected.has(issue.id) ? "bg-blue-50" : ""}`}>
                      <td className="px-3 py-2"><button onClick={e => { e.stopPropagation(); onSelect(issue.id); }}
                        className={`w-3.5 h-3.5 rounded border flex items-center justify-center text-[8px] ${selected.has(issue.id) ? "bg-blue-600 border-blue-600 text-white" : "border-gray-300 hover:border-blue-400"}`}>✓</button></td>
                      <td className="px-3 py-2" onClick={() => onDetail(issue)}><span className="font-mono font-bold text-[#0052CC]">{issue.issueKey ?? "—"}</span></td>
                      <td className="px-3 py-2" onClick={() => onDetail(issue)}>
                        <div className="flex items-center gap-1.5">
                          <span className={ty.color}>{ty.icon}</span>
                          <span className="font-medium text-gray-800 line-clamp-1">{issue.title}</span>
                          {issue.epicName && <span className="text-[10px] bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded-full shrink-0">{issue.epicName}</span>}
                          {issue.source === "agent" && <span className="text-[10px] bg-purple-100 text-purple-600 px-1 rounded shrink-0">AI</span>}
                        </div>
                      </td>
                      <td className="px-3 py-2"><select value={issue.status} onChange={e => { e.stopPropagation(); onStatusChange(issue, e.target.value as Status); }} onClick={e => e.stopPropagation()}
                        className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full border-0 cursor-pointer ${ST[issue.status].color}`}>
                        {ALL_COLS.map(s => <option key={s} value={s}>{ST[s].label}</option>)}</select></td>
                      <td className="px-3 py-2"><span className={`inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full ${pri.bg} ${pri.color}`}>{pri.icon} {pri.label}</span></td>
                      <td className="px-3 py-2">
                        {issue.assignee ? <div className="flex items-center gap-1"><div className="w-5 h-5 bg-[#0052CC] rounded-full flex items-center justify-center text-white text-[9px] font-bold">{av(issue.assignee)}</div><span className="text-[10px] text-gray-600 truncate max-w-[50px]">{issue.assignee}</span></div> : <span className="text-[10px] text-gray-400">—</span>}
                      </td>
                      <td className="px-3 py-2 text-[10px] font-bold text-gray-500">{issue.storyPoints ?? "—"}</td>
                      <td className="px-3 py-2"><span className={`text-[10px] font-semibold ${overdue ? "text-red-600 bg-red-50 px-1.5 py-0.5 rounded-full" : "text-gray-500"}`}>{issue.dueDate ? fmtDate(issue.dueDate) : "—"}{overdue && " ⏰"}</span></td>
                      {sprints.length > 0 && (
                        <td className="px-3 py-2"><select value={issue.sprintId ?? ""} onChange={e => { e.stopPropagation(); onSprintAssign(issue.id, e.target.value || null); }} onClick={e => e.stopPropagation()}
                          className="text-[10px] border border-gray-200 rounded-lg px-1.5 py-1 text-gray-600 focus:outline-none max-w-[100px]">
                          <option value="">백로그</option>
                          {sprints.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
        }
      </div>
    </div>
  );
}

// ─── Detail Panel ─────────────────────────────────────────────
function DetailPanel({ issue, boardId, allIssues, onClose, onStatusChange, onDelete, onUpdate }: {
  issue: Issue; boardId: string; allIssues: Issue[];
  onClose: () => void; onStatusChange: (s: Status) => void;
  onDelete: () => void; onUpdate: (d: Partial<Issue>) => Promise<void>;
}) {
  const [tab, setTab] = useState<"detail" | "activity" | "links">("detail");
  const [activity, setActivity] = useState<Activity[]>([]);
  const [links, setLinks] = useState<IssueLink[]>([]);
  const [comment, setComment] = useState("");
  const [author,  setAuthor]  = useState(() => typeof window !== "undefined" ? localStorage.getItem("qa_author") ?? "" : "");
  const [posting, setPosting] = useState(false);
  const [editTitle, setEditTitle] = useState(false);
  const [titleVal, setTitleVal] = useState(issue.title);
  const [addLink, setAddLink] = useState(false);
  const [linkType, setLinkType] = useState<LinkType>("relates");
  const [linkTarget, setLinkTarget] = useState("");

  const loadActivity = useCallback(async () => {
    const d = await j(`/api/boards/${boardId}/issues/${issue.id}/activity`);
    setActivity(d.activity ?? []);
  }, [boardId, issue.id]);

  const loadLinks = useCallback(async () => {
    const d = await j(`/api/boards/${boardId}/issues/${issue.id}/link`);
    setLinks(d.links ?? []);
  }, [boardId, issue.id]);

  useEffect(() => { loadActivity(); loadLinks(); }, [loadActivity, loadLinks]);

  const postComment = async (e: React.FormEvent) => {
    e.preventDefault(); if (!comment.trim()) return; setPosting(true);
    if (author) localStorage.setItem("qa_author", author);
    await jpost(`/api/boards/${boardId}/issues/${issue.id}/comments`, { content: comment, authorName: author || "익명" });
    setComment(""); await loadActivity(); setPosting(false);
  };

  const saveTitle = async () => {
    if (!titleVal.trim() || titleVal === issue.title) { setEditTitle(false); return; }
    await onUpdate({ title: titleVal }); setEditTitle(false);
  };

  const addIssueLink = async () => {
    const target = allIssues.find(i => i.issueKey === linkTarget || i.id === linkTarget);
    if (!target) return;
    await jpost(`/api/boards/${boardId}/issues/${issue.id}/link`, { linkType, targetIssueId: target.id });
    await loadLinks(); setAddLink(false); setLinkTarget("");
  };

  const removeLink = async (linkId: string) => {
    await jdel(`/api/boards/${boardId}/issues/${issue.id}/link`);
    // need body — use a workaround
    await fetch(`/api/boards/${boardId}/issues/${issue.id}/link`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ linkId }) });
    await loadLinks();
  };

  const pri = PRI[issue.priority]; const ty = TYPE[issue.type];
  const overdue = isOverdue(issue.dueDate) && issue.status !== "done";

  return (
    <div className="w-[520px] bg-white border-l flex flex-col shrink-0 shadow-2xl overflow-hidden">
      {/* Header */}
      <div className="px-4 py-2.5 bg-gray-50 border-b flex items-center gap-2 shrink-0">
        <span className="font-mono text-xs font-black text-[#0052CC]">{issue.issueKey ?? "—"}</span>
        <span className={`text-xs ${ty.color}`}>{ty.icon} {ty.label}</span>
        {issue.epicName && <span className="text-[10px] bg-purple-100 text-purple-700 font-semibold px-2 py-0.5 rounded-full">{issue.epicName}</span>}
        {issue.storyPoints != null && <span className="text-[10px] bg-gray-200 text-gray-600 font-bold px-2 py-0.5 rounded-full">{issue.storyPoints}pt</span>}
        <button onClick={onClose} className="ml-auto text-gray-400 hover:text-gray-600 text-base leading-none">✕</button>
      </div>
      {/* Title */}
      <div className="px-4 py-3 border-b shrink-0">
        {editTitle
          ? <input value={titleVal} onChange={e => setTitleVal(e.target.value)} autoFocus
              onBlur={saveTitle} onKeyDown={e => { if (e.key === "Enter") saveTitle(); if (e.key === "Escape") setEditTitle(false); }}
              className="w-full text-sm font-bold border border-blue-400 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-300" />
          : <h2 className="text-sm font-bold text-gray-800 cursor-pointer hover:text-[#0052CC] group" onClick={() => setEditTitle(true)}>
              {issue.title}
              <span className="ml-2 text-[10px] text-gray-300 font-normal group-hover:text-gray-400">✏ 수정</span>
            </h2>
        }
        <p className="text-[10px] text-gray-400 mt-1">
          {rt(issue.createdAt)}{issue.reporter && ` · 보고자: ${issue.reporter}`}{issue.source === "agent" && " · 🤖 AI"}
        </p>
      </div>
      {/* Meta grid */}
      <div className="px-4 py-3 border-b bg-gray-50 shrink-0">
        <div className="grid grid-cols-2 gap-2.5">
          {/* Status */}
          <div>
            <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wide mb-1">상태</p>
            <select value={issue.status} onChange={e => onStatusChange(e.target.value as Status)}
              className={`w-full text-xs font-bold border-0 rounded-lg px-2 py-1.5 cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-300 ${ST[issue.status].color}`}>
              {ALL_COLS.map(s => <option key={s} value={s}>{ST[s].label}</option>)}
            </select>
          </div>
          {/* Priority */}
          <div>
            <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wide mb-1">우선순위</p>
            <select value={issue.priority} onChange={e => onUpdate({ priority: e.target.value as Priority })}
              className={`w-full text-xs font-bold border-0 rounded-lg px-2 py-1.5 cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-300 ${PRI[issue.priority].bg} ${PRI[issue.priority].color}`}>
              {(Object.keys(PRI) as Priority[]).map(p => <option key={p} value={p}>{PRI[p].icon} {PRI[p].label}</option>)}
            </select>
          </div>
          {/* Assignee */}
          <div>
            <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wide mb-1">담당자</p>
            <input defaultValue={issue.assignee ?? ""} placeholder="이름 입력" onBlur={e => onUpdate({ assignee: e.target.value || undefined })}
              className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-300" />
          </div>
          {/* Type */}
          <div>
            <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wide mb-1">유형</p>
            <select value={issue.type} onChange={e => onUpdate({ type: e.target.value as IssueType })}
              className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-300">
              {(Object.keys(TYPE) as IssueType[]).map(t => <option key={t} value={t}>{TYPE[t].icon} {TYPE[t].label}</option>)}
            </select>
          </div>
          {/* Story Points */}
          <div>
            <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wide mb-1">스토리 포인트</p>
            <input type="number" min={0} max={100} defaultValue={issue.storyPoints ?? ""} placeholder="0"
              onBlur={e => onUpdate({ storyPoints: e.target.value ? Number(e.target.value) : undefined })}
              className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-300" />
          </div>
          {/* Due date */}
          <div>
            <p className={`text-[10px] font-bold uppercase tracking-wide mb-1 ${overdue ? "text-red-500" : "text-gray-500"}`}>기한{overdue && " ⏰ 초과"}</p>
            <input type="date" defaultValue={issue.dueDate ? issue.dueDate.slice(0, 10) : ""}
              onBlur={e => onUpdate({ dueDate: e.target.value || undefined })}
              className={`w-full text-xs border rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-300 ${overdue ? "border-red-300 bg-red-50" : "border-gray-200"}`} />
          </div>
          {/* Epic */}
          <div>
            <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wide mb-1">에픽</p>
            <input defaultValue={issue.epicName ?? ""} placeholder="에픽 이름" onBlur={e => onUpdate({ epicName: e.target.value || undefined })}
              className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-300" />
          </div>
          {/* Environment */}
          <div>
            <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wide mb-1">환경</p>
            <input defaultValue={issue.environment ?? ""} placeholder="Chrome / macOS" onBlur={e => onUpdate({ environment: e.target.value || undefined })}
              className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-300" />
          </div>
        </div>
      </div>
      {/* Tabs */}
      <div className="flex border-b shrink-0">
        {(["detail", "activity", "links"] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`flex-1 text-[10px] font-bold py-2 transition-colors ${tab === t ? "border-b-2 border-[#0052CC] text-[#0052CC]" : "text-gray-400 hover:text-gray-600"}`}>
            {t === "detail" ? "상세" : t === "activity" ? `활동 ${activity.length}` : `링크 ${links.length}`}
          </button>
        ))}
      </div>
      {/* Tab content */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {tab === "detail" && (
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {issue.screenshotUrl && <div><p className="text-[10px] font-bold text-gray-500 uppercase mb-1.5">스크린샷</p><a href={issue.screenshotUrl} target="_blank" rel="noopener noreferrer"><img src={issue.screenshotUrl} alt="" className="w-full rounded-xl border border-gray-200 hover:opacity-90" /></a></div>}
            {issue.description && <div><p className="text-[10px] font-bold text-gray-500 uppercase mb-1.5">설명</p><p className="text-xs text-gray-600 leading-relaxed whitespace-pre-wrap bg-gray-50 rounded-xl p-3">{issue.description}</p></div>}
            {issue.stepToReproduce && <div><p className="text-[10px] font-bold text-gray-500 uppercase mb-1.5">재현 단계</p><pre className="text-xs bg-gray-50 border border-gray-200 rounded-xl p-3 whitespace-pre-wrap font-mono leading-relaxed">{issue.stepToReproduce}</pre></div>}
            {(issue.expectedResult || issue.actualResult) && (
              <div className="grid grid-cols-2 gap-2">
                {issue.expectedResult && <div><p className="text-[10px] font-bold text-green-600 uppercase mb-1">✅ 기대</p><p className="text-xs bg-green-50 border border-green-200 rounded-xl p-2.5 text-green-800">{issue.expectedResult}</p></div>}
                {issue.actualResult && <div><p className="text-[10px] font-bold text-red-600 uppercase mb-1">❌ 실제</p><p className="text-xs bg-red-50 border border-red-200 rounded-xl p-2.5 text-red-800">{issue.actualResult}</p></div>}
              </div>
            )}
            {issue.targetUrl && <div><p className="text-[10px] font-bold text-gray-500 uppercase mb-1.5">URL</p><a href={issue.targetUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-[#0052CC] hover:underline break-all">{issue.targetUrl}</a></div>}
          </div>
        )}

        {tab === "activity" && (
          <>
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {activity.length === 0 ? <p className="text-xs text-gray-400 text-center py-10">활동 없음</p> :
                activity.map(a => (
                  <div key={a.id} className="flex gap-2">
                    {a.kind === "comment"
                      ? <><div className="w-6 h-6 bg-[#0052CC] rounded-full flex items-center justify-center text-white text-[8px] font-black shrink-0 mt-0.5">{av(a.authorName)}</div>
                          <div className="flex-1 bg-gray-50 rounded-xl p-2.5">
                            <div className="flex items-center gap-2 mb-1"><span className="text-[10px] font-bold text-gray-700">{a.authorName}</span><span className="text-[10px] text-gray-400 ml-auto">{rt(a.createdAt)}</span></div>
                            <p className="text-xs text-gray-600 leading-relaxed">{a.content}</p>
                          </div></>
                      : <><div className="w-6 h-6 bg-gray-200 rounded-full flex items-center justify-center text-gray-500 text-[10px] shrink-0 mt-0.5">📝</div>
                          <div className="flex-1 py-1"><span className="text-[10px] text-gray-500"><strong>{a.field}</strong> <span className="line-through text-gray-400">{a.oldValue || "없음"}</span> → <strong>{a.newValue}</strong></span><span className="text-[10px] text-gray-400 ml-2">{rt(a.createdAt)}</span></div></>
                    }
                  </div>
                ))
              }
            </div>
            <form onSubmit={postComment} className="border-t p-3 space-y-2 shrink-0">
              <input value={author} onChange={e => setAuthor(e.target.value)} placeholder="이름 (선택)"
                className="w-full text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-300" />
              <textarea value={comment} onChange={e => setComment(e.target.value)} rows={2} placeholder="댓글 작성..."
                className="w-full text-xs border border-gray-200 rounded-lg px-2.5 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-blue-300" />
              <button type="submit" disabled={posting || !comment.trim()}
                className="w-full text-xs font-bold bg-[#0052CC] text-white py-1.5 rounded-lg hover:bg-blue-700 disabled:opacity-40">
                {posting ? "등록 중..." : "댓글 등록"}
              </button>
            </form>
          </>
        )}

        {tab === "links" && (
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {links.length === 0 && !addLink && <p className="text-xs text-gray-400 text-center py-8">연결된 이슈가 없습니다</p>}
            {links.map(link => {
              const other = link.from.id === issue.id ? link.to : link.from;
              const isFrom = link.from.id === issue.id;
              return (
                <div key={link.id} className="flex items-center gap-2 p-2.5 bg-gray-50 border border-gray-200 rounded-xl">
                  <span className="text-[10px] text-gray-500 shrink-0">{isFrom ? LINK_LABELS[link.linkType] : "차단됨"}</span>
                  <span className="font-mono text-[10px] text-[#0052CC] font-bold shrink-0">{other.issueKey}</span>
                  <span className="text-xs text-gray-700 flex-1 truncate">{other.title}</span>
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${ST[other.status as Status]?.color ?? "bg-gray-100 text-gray-500"}`}>{ST[other.status as Status]?.label ?? other.status}</span>
                  <button onClick={() => removeLink(link.id)} className="text-gray-400 hover:text-red-500 text-xs ml-1">✕</button>
                </div>
              );
            })}
            {addLink ? (
              <div className="border border-blue-200 rounded-xl p-3 bg-blue-50 space-y-2">
                <div className="flex gap-2">
                  <select value={linkType} onChange={e => setLinkType(e.target.value as LinkType)}
                    className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none">
                    {(Object.keys(LINK_LABELS) as LinkType[]).map(t => <option key={t} value={t}>{LINK_LABELS[t]}</option>)}
                  </select>
                  <input value={linkTarget} onChange={e => setLinkTarget(e.target.value)} placeholder="이슈 키 (예: QA-3)"
                    list="issue-list"
                    className="flex-1 text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-300" />
                  <datalist id="issue-list">{allIssues.filter(i => i.id !== issue.id).map(i => <option key={i.id} value={i.issueKey ?? i.id}>{i.title}</option>)}</datalist>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => { setAddLink(false); setLinkTarget(""); }} className="flex-1 text-xs border border-gray-200 py-1.5 rounded-lg text-gray-600 hover:bg-gray-100">취소</button>
                  <button onClick={addIssueLink} disabled={!linkTarget} className="flex-1 text-xs font-bold bg-[#0052CC] text-white py-1.5 rounded-lg hover:bg-blue-700 disabled:opacity-40">연결</button>
                </div>
              </div>
            ) : (
              <button onClick={() => setAddLink(true)} className="w-full text-xs text-[#0052CC] border border-dashed border-blue-300 py-2 rounded-xl hover:bg-blue-50">+ 이슈 연결</button>
            )}
          </div>
        )}
      </div>
      {/* Delete */}
      <div className="border-t p-3 shrink-0">
        <button onClick={onDelete} className="w-full text-xs font-semibold text-red-500 border border-red-200 py-1.5 rounded-xl hover:bg-red-50">이슈 삭제</button>
      </div>
    </div>
  );
}

// ─── Create Board Modal ───────────────────────────────────────
function CreateBoardModal({ onClose, onCreated }: { onClose: () => void; onCreated: (b: Board) => void }) {
  const [name, setName] = useState(""); const [key, setKey] = useState("QA"); const [desc, setDesc] = useState(""); const [url, setUrl] = useState("");
  const [saving, setSaving] = useState(false); const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); if (!name.trim()) { setError("이름을 입력하세요."); return; }
    setSaving(true); setError("");
    try {
      const d = await jpost("/api/boards", { name, boardKey: key.toUpperCase() || "QA", description: desc || undefined, targetUrl: url || undefined }) as { board?: Board; error?: string };
      if (d.error) { setError(d.error); setSaving(false); return; }
      if (d.board) onCreated(d.board);
    } catch (err) { setError(String(err)); setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
        <div className="px-6 py-5 border-b flex items-center justify-between"><h2 className="text-lg font-black text-gray-800">새 QA 보드</h2><button onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button></div>
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2 rounded-xl">{error}</div>}
          <div><label className="block text-xs font-bold text-gray-600 uppercase mb-1.5">보드 이름 *</label>
            <input value={name} onChange={e => setName(e.target.value)} required autoFocus placeholder="예: 회원가입 QA"
              className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" /></div>
          <div><label className="block text-xs font-bold text-gray-600 uppercase mb-1.5">이슈 키</label>
            <div className="flex items-center gap-3">
              <input value={key} onChange={e => setKey(e.target.value.toUpperCase().replace(/[^A-Z]/g, ""))} maxLength={6} placeholder="QA"
                className="w-20 border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-mono font-black text-[#0052CC] focus:outline-none focus:ring-2 focus:ring-blue-400" />
              <span className="text-xs text-gray-400">이슈: <strong className="text-[#0052CC] font-mono">{key||"QA"}-1</strong>, <strong className="text-[#0052CC] font-mono">{key||"QA"}-2</strong>…</span>
            </div></div>
          <div><label className="block text-xs font-bold text-gray-600 uppercase mb-1.5">설명</label>
            <input value={desc} onChange={e => setDesc(e.target.value)} placeholder="보드 설명"
              className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" /></div>
          <div><label className="block text-xs font-bold text-gray-600 uppercase mb-1.5">대상 URL</label>
            <input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://example.com"
              className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" /></div>
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} className="flex-1 border border-gray-200 text-gray-600 py-2.5 rounded-xl text-sm font-semibold hover:bg-gray-50">취소</button>
            <button type="submit" disabled={saving} className="flex-1 bg-[#0052CC] text-white py-2.5 rounded-xl text-sm font-black hover:bg-blue-700 disabled:opacity-50">{saving ? "생성 중..." : "보드 만들기"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Create Issue Modal ───────────────────────────────────────
function CreateIssueModal({ boardId, sprints, epics, onClose, onCreated }: { boardId: string; sprints: Sprint[]; epics: string[]; onClose: () => void; onCreated: () => void }) {
  const [f, setF] = useState({ title: "", description: "", type: "bug" as IssueType, priority: "medium" as Priority, assignee: "", reporter: "", epicName: "", storyPoints: "", environment: "", step: "", expected: "", actual: "", url: "", dueDate: "", sprintId: "" });
  const [saving, setSaving] = useState(false); const [error, setError] = useState("");
  const [figmaPreview, setFigmaPreview] = useState<string | null>(null);
  const [figmaLoading, setFigmaLoading] = useState(false);
  const u = (k: string, v: string) => setF(p => ({ ...p, [k]: v }));

  // Figma URL 입력 시 프레임 미리보기 자동 로드
  const handleUrlChange = async (url: string) => {
    u("url", url);
    setFigmaPreview(null);
    if (!url.includes("figma.com") || !url.includes("node-id")) return;
    setFigmaLoading(true);
    try {
      const d = await j(`/api/figma/frame-preview?url=${encodeURIComponent(url)}`);
      if (d.imageUrl) setFigmaPreview(d.imageUrl);
    } catch { /* ignore */ } finally { setFigmaLoading(false); }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); if (!f.title.trim()) { setError("제목을 입력하세요."); return; }
    setSaving(true); setError("");
    try {
      const d = await jpost(`/api/boards/${boardId}/issues`, {
        title: f.title, description: f.description || undefined, type: f.type, priority: f.priority,
        assignee: f.assignee || undefined, reporter: f.reporter || undefined,
        epicName: f.epicName || undefined, storyPoints: f.storyPoints ? Number(f.storyPoints) : undefined,
        environment: f.environment || undefined, stepToReproduce: f.step || undefined,
        expectedResult: f.expected || undefined, actualResult: f.actual || undefined,
        targetUrl: f.url || undefined, dueDate: f.dueDate || undefined, sprintId: f.sprintId || undefined,
      }) as { error?: string };
      if (d.error) { setError(d.error); setSaving(false); return; }
      onCreated();
    } catch (err) { setError(String(err)); setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl my-4" onClick={e => e.stopPropagation()}>
        <div className="px-6 py-4 border-b flex items-center justify-between sticky top-0 bg-white rounded-t-2xl z-10">
          <h2 className="text-lg font-black text-gray-800">이슈 만들기</h2>
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-400">단축키: C</span>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
          </div>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2 rounded-xl">{error}</div>}
          {/* Type + Priority */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-gray-600 uppercase mb-1.5">유형</label>
              <div className="flex flex-wrap gap-1">{(Object.keys(TYPE) as IssueType[]).map(t => (
                <button key={t} type="button" onClick={() => u("type", t)}
                  className={`flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-lg border transition-all ${f.type === t ? "border-[#0052CC] bg-blue-50 text-[#0052CC]" : "border-gray-200 text-gray-500 hover:border-gray-300"}`}>
                  {TYPE[t].icon} {TYPE[t].label}</button>
              ))}</div>
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-600 uppercase mb-1.5">우선순위</label>
              <div className="flex flex-wrap gap-1">{(Object.keys(PRI) as Priority[]).map(p => (
                <button key={p} type="button" onClick={() => u("priority", p)}
                  className={`flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-lg border transition-all ${f.priority === p ? `border-current ${PRI[p].bg} ${PRI[p].color}` : "border-gray-200 text-gray-500 hover:border-gray-300"}`}>
                  {PRI[p].icon} {PRI[p].label}</button>
              ))}</div>
            </div>
          </div>
          {/* Title */}
          <div><label className="block text-xs font-bold text-gray-600 uppercase mb-1.5">제목 *</label>
            <input value={f.title} onChange={e => u("title", e.target.value)} required autoFocus placeholder="이슈를 한 줄로 설명하세요"
              className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" /></div>
          {/* Description */}
          <div><label className="block text-xs font-bold text-gray-600 uppercase mb-1.5">설명</label>
            <textarea value={f.description} onChange={e => u("description", e.target.value)} rows={2} placeholder="상세 설명"
              className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-400" /></div>
          {/* Steps */}
          <div><label className="block text-xs font-bold text-gray-600 uppercase mb-1.5">재현 단계</label>
            <textarea value={f.step} onChange={e => u("step", e.target.value)} rows={3} placeholder={"1. 접속\n2. 클릭\n3. 결과 확인"}
              className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-400 font-mono" /></div>
          {/* Expected / Actual */}
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-xs font-bold text-green-600 uppercase mb-1.5">✅ 기대 결과</label>
              <textarea value={f.expected} onChange={e => u("expected", e.target.value)} rows={2} className="w-full border border-green-200 rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-green-300" /></div>
            <div><label className="block text-xs font-bold text-red-600 uppercase mb-1.5">❌ 실제 결과</label>
              <textarea value={f.actual} onChange={e => u("actual", e.target.value)} rows={2} className="w-full border border-red-200 rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-red-300" /></div>
          </div>
          {/* Meta fields */}
          <div className="grid grid-cols-3 gap-3">
            <div><label className="block text-xs font-bold text-gray-600 uppercase mb-1.5">담당자</label>
              <input value={f.assignee} onChange={e => u("assignee", e.target.value)} placeholder="이름"
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" /></div>
            <div><label className="block text-xs font-bold text-gray-600 uppercase mb-1.5">에픽</label>
              <input value={f.epicName} onChange={e => u("epicName", e.target.value)} placeholder="에픽 이름" list="epic-list"
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
              <datalist id="epic-list">{epics.map(ep => <option key={ep} value={ep} />)}</datalist></div>
            <div><label className="block text-xs font-bold text-gray-600 uppercase mb-1.5">SP</label>
              <input type="number" min={0} max={100} value={f.storyPoints} onChange={e => u("storyPoints", e.target.value)} placeholder="0"
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" /></div>
            <div><label className="block text-xs font-bold text-gray-600 uppercase mb-1.5">기한</label>
              <input type="date" value={f.dueDate} onChange={e => u("dueDate", e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" /></div>
            <div><label className="block text-xs font-bold text-gray-600 uppercase mb-1.5">환경</label>
              <input value={f.environment} onChange={e => u("environment", e.target.value)} placeholder="Chrome / macOS"
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" /></div>
            {sprints.length > 0 && (
              <div><label className="block text-xs font-bold text-gray-600 uppercase mb-1.5">스프린트</label>
                <select value={f.sprintId} onChange={e => u("sprintId", e.target.value)}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
                  <option value="">백로그</option>
                  {sprints.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select></div>
            )}
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-600 uppercase mb-1.5">
              URL
              {f.url.includes("figma.com") && (
                <span className="ml-2 text-[10px] bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded-full font-bold normal-case">
                  🎨 Figma 연동됨 — 댓글 자동 등록
                </span>
              )}
            </label>
            <input value={f.url} onChange={e => handleUrlChange(e.target.value)}
              placeholder="https://example.com  또는  figma.com/file/... (Figma URL 입력 시 자동 연동)"
              className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
            {/* Figma 프레임 미리보기 */}
            {figmaLoading && <p className="text-xs text-purple-500 mt-1.5">🎨 Figma 프레임 로딩 중...</p>}
            {figmaPreview && (
              <div className="mt-2 rounded-xl overflow-hidden border-2 border-purple-200">
                <img src={figmaPreview} alt="Figma 프레임 미리보기" className="w-full max-h-48 object-cover object-top" />
                <p className="text-[10px] text-center text-purple-600 bg-purple-50 py-1 font-semibold">Figma 프레임 미리보기 — 이슈 생성 시 스크린샷으로 첨부됩니다</p>
              </div>
            )}
          </div>
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} className="flex-1 border border-gray-200 text-gray-600 py-2.5 rounded-xl text-sm font-semibold hover:bg-gray-50">취소</button>
            <button type="submit" disabled={saving} className="flex-1 bg-[#0052CC] text-white py-2.5 rounded-xl text-sm font-black hover:bg-blue-700 disabled:opacity-50">{saving ? "생성 중..." : "이슈 만들기"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Sprint Modal ─────────────────────────────────────────────
function SprintModal({ boardId, sprints, onClose, onChanged }: { boardId: string; sprints: Sprint[]; onClose: () => void; onChanged: () => void }) {
  const [name, setName] = useState(""); const [goal, setGoal] = useState(""); const [start, setStart] = useState(""); const [end, setEnd] = useState("");
  const [creating, setCreating] = useState(false);

  const handleCreate = async () => {
    if (!name.trim()) return; setCreating(true);
    await jpost(`/api/boards/${boardId}/sprints`, { name, goal: goal || undefined, startDate: start || undefined, endDate: end || undefined });
    onChanged();
  };
  const toggleActive = async (sprint: Sprint) => {
    const newStatus = sprint.status === "active" ? "completed" : sprint.status === "planning" ? "active" : "planning";
    await jpatch(`/api/boards/${boardId}/sprints/${sprint.id}`, { status: newStatus });
    onChanged();
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-6 py-5 border-b flex items-center justify-between shrink-0">
          <h2 className="text-lg font-black text-gray-800">스프린트 관리</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {/* Existing sprints */}
          {sprints.length > 0 && (
            <div className="space-y-2">
              {sprints.map(s => (
                <div key={s.id} className="flex items-center gap-3 p-3 bg-gray-50 border border-gray-200 rounded-xl">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-bold text-gray-800">{s.name}</p>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${s.status === "active" ? "bg-green-100 text-green-700" : s.status === "completed" ? "bg-gray-200 text-gray-500" : "bg-blue-100 text-blue-700"}`}>
                        {s.status === "active" ? "🏃 진행 중" : s.status === "completed" ? "✅ 완료" : "📋 계획 중"}
                      </span>
                    </div>
                    {s.goal && <p className="text-xs text-gray-500 mt-0.5 truncate">{s.goal}</p>}
                    {(s.startDate || s.endDate) && <p className="text-xs text-gray-400">{fmtDate(s.startDate)} ~ {fmtDate(s.endDate)}</p>}
                  </div>
                  <button onClick={() => toggleActive(s)}
                    className={`text-xs font-bold px-3 py-1.5 rounded-lg transition-all ${s.status === "planning" ? "bg-green-500 text-white hover:bg-green-600" : s.status === "active" ? "bg-gray-200 text-gray-600 hover:bg-gray-300" : "bg-blue-100 text-blue-600"}`}>
                    {s.status === "planning" ? "시작" : s.status === "active" ? "완료" : "재시작"}
                  </button>
                </div>
              ))}
            </div>
          )}
          {/* Create new sprint */}
          <div className="border-t pt-4 space-y-3">
            <p className="text-xs font-bold text-gray-600 uppercase">새 스프린트</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2"><input value={name} onChange={e => setName(e.target.value)} placeholder="스프린트 이름 (예: 스프린트 1)"
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" /></div>
              <div className="col-span-2"><input value={goal} onChange={e => setGoal(e.target.value)} placeholder="스프린트 목표 (선택)"
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" /></div>
              <div><label className="block text-xs text-gray-500 mb-1">시작일</label>
                <input type="date" value={start} onChange={e => setStart(e.target.value)} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" /></div>
              <div><label className="block text-xs text-gray-500 mb-1">종료일</label>
                <input type="date" value={end} onChange={e => setEnd(e.target.value)} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" /></div>
            </div>
            <button onClick={handleCreate} disabled={creating || !name.trim()}
              className="w-full bg-[#0052CC] text-white py-2.5 rounded-xl text-sm font-black hover:bg-blue-700 disabled:opacity-40">
              {creating ? "생성 중..." : "+ 스프린트 만들기"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Import Modal ─────────────────────────────────────────────
function ImportModal({ boardId, onClose, onImported }: { boardId: string; onClose: () => void; onImported: () => void }) {
  const [reports, setReports] = useState<SavedReport[]>([]); const [sel, setSel] = useState<SavedReport | null>(null);
  const [checked, setChecked] = useState<Set<number>>(new Set()); const [importing, setImporting] = useState(false); const [loading, setLoading] = useState(true);
  useEffect(() => { j("/api/reports/list").then((d: { reports?: SavedReport[] }) => { setReports(d.reports ?? []); setLoading(false); }); }, []);
  const selectR = (r: SavedReport) => { setSel(r); setChecked(new Set(r.findings.map((_, i) => i))); };
  const toggle = (i: number) => setChecked(p => { const n = new Set(p); n.has(i) ? n.delete(i) : n.add(i); return n; });
  const handleImport = async () => {
    if (!sel || checked.size === 0) return; setImporting(true);
    const findings = Array.from(checked).map(i => sel.findings[i]);
    await jpost(`/api/boards/${boardId}/issues/import`, { findings: findings.map(f => ({ ...f, targetUrl: sel.targetUrl })) });
    onImported();
  };
  const s2p = (s: string) => ({ critical: "⛔", high: "🔴", medium: "🟡", low: "🔵" })[s] ?? "🟡";
  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-6 py-5 border-b flex items-center justify-between shrink-0"><h2 className="text-lg font-black text-gray-800">AI 결과 가져오기</h2><button onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button></div>
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading ? <p className="text-center text-gray-400 py-10">로딩 중...</p>
          : reports.length === 0 ? <div className="text-center py-12 text-gray-400"><p className="text-3xl mb-3">📭</p><p className="font-semibold">저장된 리포트 없음</p><p className="text-xs mt-1">Auto Agent 실행 후 리포트를 저장하면 가져올 수 있습니다</p></div>
          : !sel ? <div className="space-y-2">{reports.map(r => (
              <button key={r.id} onClick={() => selectR(r)} className="w-full text-left p-4 border border-gray-200 rounded-xl hover:border-[#0052CC] hover:bg-blue-50 transition-all">
                <div className="flex items-start gap-3"><div className="flex-1 min-w-0"><p className="text-sm font-bold text-gray-800 truncate">{r.name}</p><p className="text-xs text-gray-400 truncate">{r.targetUrl}</p><span className={`text-xs font-bold px-2 py-0.5 rounded-full mt-1 inline-block ${r.riskLevel === "critical" ? "bg-red-100 text-red-700" : "bg-orange-100 text-orange-700"}`}>{r.riskLevel} · {Math.round(r.passRate)}% 통과</span></div><div className="text-right shrink-0"><p className="text-sm font-black text-red-600">{r.findingCount}개 발견</p><p className="text-xs text-gray-400">{new Date(r.savedAt).toLocaleDateString("ko-KR")}</p></div></div>
              </button>))}</div>
          : <div className="space-y-3">
              <div className="flex items-center gap-2"><button onClick={() => setSel(null)} className="text-xs text-[#0052CC] hover:underline">← 뒤로</button><span className="text-sm font-bold text-gray-700 flex-1 truncate">{sel.name}</span><button onClick={() => setChecked(checked.size === sel.findings.length ? new Set() : new Set(sel.findings.map((_, i) => i)))} className="text-xs text-[#0052CC] hover:underline">{checked.size === sel.findings.length ? "전체 해제" : "전체 선택"}</button></div>
              <div className="space-y-2">{sel.findings.map((f, i) => (
                <label key={i} onClick={() => toggle(i)} className={`flex items-start gap-3 p-3 border rounded-xl cursor-pointer transition-all ${checked.has(i) ? "border-[#0052CC] bg-blue-50" : "border-gray-200 hover:border-gray-300"}`}>
                  <input type="checkbox" checked={checked.has(i)} onChange={() => toggle(i)} className="mt-0.5 accent-blue-600" />
                  <div className="flex-1 min-w-0"><div className="flex items-center gap-1.5 mb-0.5"><span>{s2p(f.severity)}</span><span className="text-[10px] text-gray-400 capitalize">{f.severity}</span></div><p className="text-sm font-semibold text-gray-800">{f.title}</p>{f.description && <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{f.description}</p>}</div>
                </label>))}
              </div>
            </div>
          }
        </div>
        {sel && <div className="px-6 py-4 border-t bg-gray-50 flex items-center gap-3 shrink-0"><span className="text-sm text-gray-600 font-semibold">{checked.size}개 선택</span><button onClick={onClose} className="flex-1 border border-gray-200 text-gray-600 py-2 rounded-xl text-sm hover:bg-gray-100">취소</button><button onClick={handleImport} disabled={importing || checked.size === 0} className="flex-1 bg-[#0052CC] text-white py-2 rounded-xl text-sm font-black hover:bg-blue-700 disabled:opacity-40">{importing ? "가져오는 중..." : `${checked.size}개 이슈로 추가`}</button></div>}
      </div>
    </div>
  );
}

// ─── Share Modal ──────────────────────────────────────────────
function ShareModal({ board, onCopy, onCreated, onClose }: { board: Board; onCopy: (t: string) => void; onCreated: () => void; onClose: () => void }) {
  const [label, setLabel] = useState(""); const [creating, setCreating] = useState(false); const [copiedId, setCopiedId] = useState<string | null>(null);
  const copy = async (token: string, id: string) => { onCopy(token); setCopiedId(id); setTimeout(() => setCopiedId(null), 2000); };
  const create = async () => { setCreating(true); const d = await jpost(`/api/boards/${board.id}/share`, { label: label || undefined }) as { link?: ShareLink }; if (d.link) { await onCreated(); setLabel(""); } setCreating(false); };
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
        <div className="px-6 py-5 border-b flex items-center justify-between"><h2 className="text-lg font-black text-gray-800">공유 링크</h2><button onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button></div>
        <div className="px-6 py-5 space-y-4">
          {board.shareLinks.map(link => (
            <div key={link.id} className="flex items-center gap-3 bg-gray-50 border border-gray-200 rounded-xl p-3">
              <div className="flex-1 min-w-0"><p className="text-xs font-bold text-gray-700">{link.label ?? "공유 링크"}</p><p className="text-xs text-gray-400 truncate">{origin}/share/{link.publicToken}</p><p className="text-[10px] text-gray-400 mt-0.5">👁 {link.viewCount}회 조회</p></div>
              <button onClick={() => copy(link.publicToken, link.id)} className={`text-xs font-bold px-3 py-1.5 rounded-lg transition-all ${copiedId === link.id ? "bg-green-500 text-white" : "bg-[#0052CC] text-white hover:bg-blue-700"}`}>{copiedId === link.id ? "✅ 복사됨" : "복사"}</button>
            </div>
          ))}
          <div className="border-t pt-4"><p className="text-xs font-bold text-gray-500 uppercase mb-2">새 링크 생성</p>
            <div className="flex gap-2"><input value={label} onChange={e => setLabel(e.target.value)} placeholder="링크 이름 (선택)" className="flex-1 text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400" /><button onClick={create} disabled={creating} className="text-sm font-bold bg-[#0052CC] text-white px-4 py-2 rounded-xl hover:bg-blue-700 disabled:opacity-50">{creating ? "..." : "생성"}</button></div>
            <p className="text-xs text-gray-400 mt-2">로그인 없이 누구나 이 보드를 볼 수 있습니다</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Board Settings Modal (Figma + GitHub 연동) ───────────────
function BoardSettingsModal({ board, onClose, onSaved }: { board: Board; onClose: () => void; onSaved: () => void }) {
  const [tab, setTab] = useState<"figma" | "github">("figma");
  const [figmaUrl, setFigmaUrl]   = useState(board.figmaFileUrl ?? "");
  const [ghOwner,  setGhOwner]    = useState(board.githubOwner  ?? "");
  const [ghRepo,   setGhRepo]     = useState(board.githubRepo   ?? "");
  const [ghToken,  setGhToken]    = useState("");
  const [saving,   setSaving]     = useState(false);
  const [testing,  setTesting]    = useState(false);
  const [testMsg,  setTestMsg]    = useState("");
  const [saved,    setSavedMsg]   = useState("");

  const handleSave = async () => {
    setSaving(true); setSavedMsg("");
    const body: Record<string, string> = {};
    if (tab === "figma") body.figmaFileUrl = figmaUrl;
    if (tab === "github") {
      body.githubOwner = ghOwner;
      body.githubRepo  = ghRepo;
      if (ghToken) body.githubToken = ghToken;
    }
    await jpatch(`/api/boards/${board.id}/settings`, body);
    setSaving(false); setSavedMsg("✅ 저장됐습니다");
    setTimeout(() => { setSavedMsg(""); onSaved(); }, 1200);
  };

  const handleTestGithub = async () => {
    setTesting(true); setTestMsg("");
    const d = await jpost(`/api/boards/${board.id}/settings`, { action: "test-github" }) as { ok: boolean; repoName?: string; error?: string };
    setTesting(false);
    setTestMsg(d.ok ? `✅ 연결 성공: ${d.repoName}` : `❌ 연결 실패: ${d.error ?? "토큰/레포를 확인하세요"}`);
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg" onClick={e => e.stopPropagation()}>
        <div className="px-6 py-5 border-b flex items-center justify-between">
          <div>
            <h2 className="text-base font-black text-gray-800">보드 연동 설정</h2>
            <p className="text-xs text-gray-400 mt-0.5">{board.name}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>

        {/* 탭 */}
        <div className="flex border-b">
          {(["figma", "github"] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`flex-1 py-3 text-sm font-bold transition-colors ${tab === t ? "border-b-2 border-[#0052CC] text-[#0052CC]" : "text-gray-400 hover:text-gray-600"}`}>
              {t === "figma" ? "🎨 Figma" : "🐙 GitHub"}
              {t === "figma" && board.figmaFileKey && " ✓"}
              {t === "github" && board.hasGithubToken && " ✓"}
            </button>
          ))}
        </div>

        <div className="px-6 py-5 space-y-4">
          {tab === "figma" && (
            <>
              <div className="bg-purple-50 border border-purple-200 rounded-xl p-3 text-xs text-purple-700">
                <strong>Figma 파일 URL</strong>을 연결하면 이슈 생성 시 Figma 파일에 댓글이 자동으로 등록됩니다.
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-600 uppercase mb-1.5">Figma 파일 URL</label>
                <input value={figmaUrl} onChange={e => setFigmaUrl(e.target.value)}
                  placeholder="https://www.figma.com/file/AbcXXX/프로젝트명"
                  className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400" />
                <p className="text-xs text-gray-400 mt-1">파일 URL만 입력 (node-id 불필요). 이슈에 Figma URL 있으면 프레임에, 없으면 파일 레벨에 댓글 등록.</p>
              </div>
              {board.figmaFileKey && (
                <div className="bg-green-50 border border-green-200 rounded-xl p-3 text-xs text-green-700">
                  ✅ 연결된 Figma 파일 키: <code className="font-mono font-bold">{board.figmaFileKey}</code>
                </div>
              )}
            </>
          )}

          {tab === "github" && (
            <>
              <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 text-xs text-gray-600">
                <strong>GitHub 레포</strong>를 연결하면 이슈 생성 시 GitHub Issue가 자동 등록되고, done 처리 시 자동으로 닫힙니다.
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-gray-600 uppercase mb-1.5">소유자 (Owner)</label>
                  <input value={ghOwner} onChange={e => setGhOwner(e.target.value)} placeholder="mmoossun"
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-600 uppercase mb-1.5">레포 이름</label>
                  <input value={ghRepo} onChange={e => setGhRepo(e.target.value)} placeholder="my-app"
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-600 uppercase mb-1.5">
                  Personal Access Token
                  {board.hasGithubToken && <span className="ml-2 text-green-600 font-normal normal-case">✅ 저장됨 (변경 시만 입력)</span>}
                </label>
                <input type="password" value={ghToken} onChange={e => setGhToken(e.target.value)}
                  placeholder={board.hasGithubToken ? "변경하려면 새 토큰 입력" : "ghp_xxxxxxxxxxxx (repo 권한 필요)"}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
                <p className="text-xs text-gray-400 mt-1">
                  GitHub → Settings → Developer settings → Personal access tokens → <strong>repo</strong> 권한 선택
                </p>
              </div>
              {testMsg && (
                <div className={`text-xs px-3 py-2 rounded-xl ${testMsg.startsWith("✅") ? "bg-green-50 text-green-700 border border-green-200" : "bg-red-50 text-red-700 border border-red-200"}`}>
                  {testMsg}
                </div>
              )}
              <button onClick={handleTestGithub} disabled={testing}
                className="w-full border border-gray-300 text-gray-700 py-2 rounded-xl text-sm font-semibold hover:bg-gray-50 disabled:opacity-50">
                {testing ? "연결 테스트 중..." : "🔌 GitHub 연결 테스트"}
              </button>
            </>
          )}

          {saved && <p className="text-sm text-green-600 font-semibold text-center">{saved}</p>}

          <div className="flex gap-3 pt-1">
            <button onClick={onClose} className="flex-1 border border-gray-200 text-gray-600 py-2.5 rounded-xl text-sm font-semibold hover:bg-gray-50">닫기</button>
            <button onClick={handleSave} disabled={saving}
              className="flex-1 bg-[#0052CC] text-white py-2.5 rounded-xl text-sm font-black hover:bg-blue-700 disabled:opacity-50">
              {saving ? "저장 중..." : "설정 저장"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
