"use client";
import { useEffect, useState, useCallback, useRef, useTransition } from "react";

// ─── Types ────────────────────────────────────────────────────
type Priority = "critical" | "high" | "medium" | "low";
type Status   = "todo" | "in_progress" | "in_review" | "done" | "wont_fix";
type IssueType = "bug" | "task" | "story" | "improvement" | "spec";

interface Comment { id: string; content: string; authorName: string; createdAt: string; }
interface HistoryEntry { id: string; field: string; oldValue?: string; newValue?: string; createdAt: string; }

interface Issue {
  id: string; issueKey?: string; title: string; description?: string;
  type: IssueType; priority: Priority; status: Status; source: string;
  assignee?: string; reporter?: string; environment?: string;
  screenshotUrl?: string; targetUrl?: string;
  stepToReproduce?: string; expectedResult?: string; actualResult?: string;
  tags: string[]; createdAt: string; updatedAt: string; resolvedAt?: string;
  _count: { comments: number };
}

interface ShareLink { id: string; publicToken: string; label?: string; viewCount: number; createdAt: string; }
interface Board {
  id: string; name: string; description?: string; targetUrl?: string;
  boardKey: string; issueCounter: number;
  createdAt: string; _count: { issues: number }; shareLinks: ShareLink[];
}

interface Finding { title: string; description: string; severity: string; rootCause: string; reproductionSteps: string; recommendation: string; screenshotPath?: string; }
interface SavedReport { id: string; name: string; targetUrl: string; status: string; riskLevel: string; passRate: number; savedAt: string; findingCount: number; findings: Finding[]; }

// ─── Config ───────────────────────────────────────────────────
const PRIORITY_CFG: Record<Priority, { label: string; icon: string; color: string; bg: string }> = {
  critical: { label: "Critical", icon: "⛔", color: "text-red-700",    bg: "bg-red-100"    },
  high:     { label: "High",     icon: "🔴", color: "text-orange-700", bg: "bg-orange-100" },
  medium:   { label: "Medium",   icon: "🟡", color: "text-yellow-700", bg: "bg-yellow-100" },
  low:      { label: "Low",      icon: "🔵", color: "text-blue-600",   bg: "bg-blue-100"   },
};
const TYPE_CFG: Record<IssueType, { label: string; icon: string; color: string }> = {
  bug:         { label: "버그",     icon: "🐛", color: "text-red-600"    },
  task:        { label: "작업",     icon: "✅", color: "text-blue-600"   },
  story:       { label: "스토리",   icon: "📖", color: "text-purple-600" },
  improvement: { label: "개선",     icon: "⚡", color: "text-yellow-600" },
  spec:        { label: "스펙",     icon: "📋", color: "text-gray-600"   },
};
const STATUS_CFG: Record<Status, { label: string; color: string; ring: string }> = {
  todo:        { label: "할 일",       color: "bg-gray-100 text-gray-600",         ring: "border-l-gray-400"   },
  in_progress: { label: "진행 중",     color: "bg-blue-100 text-blue-700",         ring: "border-l-blue-500"   },
  in_review:   { label: "검토 중",     color: "bg-purple-100 text-purple-700",     ring: "border-l-purple-500" },
  done:        { label: "완료",         color: "bg-green-100 text-green-700",       ring: "border-l-green-500"  },
  wont_fix:    { label: "해결 안 함",  color: "bg-gray-100 text-gray-500",         ring: "border-l-gray-300"   },
};
const COLUMNS: Status[] = ["todo", "in_progress", "in_review", "done", "wont_fix"];
const SEV_TO_PRIORITY: Record<string, Priority> = { critical: "critical", high: "high", medium: "medium", low: "low" };

function avatar(name?: string) {
  if (!name) return null;
  return name.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2);
}
function relTime(iso: string) {
  const d = Date.now() - new Date(iso).getTime(), m = Math.floor(d / 60000);
  if (m < 1) return "방금"; if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}시간 전`;
  return `${Math.floor(h / 24)}일 전`;
}

// ─── API ──────────────────────────────────────────────────────
async function apiFetch<T>(url: string, opts?: RequestInit): Promise<T> {
  const r = await fetch(url, opts);
  return r.json();
}
const post = (url: string, body: unknown) => apiFetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const patch = (url: string, body: unknown) => apiFetch(url, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const del = (url: string) => fetch(url, { method: "DELETE" });

// ─── Main ─────────────────────────────────────────────────────
type View = "board" | "backlog";
type Modal = "create-board" | "create-issue" | "import" | "share" | null;

export default function BoardPage() {
  const [boards, setBoards] = useState<Board[]>([]);
  const [active, setActive] = useState<Board | null>(null);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [loadingBoards, setLoadingBoards] = useState(true);
  const [view, setView] = useState<View>("board");
  const [search, setSearch] = useState("");
  const [priFilter, setPriFilter] = useState<Priority | "all">("all");
  const [typeFilter, setTypeFilter] = useState<IssueType | "all">("all");
  const [assigneeFilter, setAssigneeFilter] = useState("all");
  const [detail, setDetail] = useState<Issue | null>(null);
  const [modal, setModal] = useState<Modal>(null);
  const [, startTransition] = useTransition();

  const loadBoards = useCallback(async () => {
    const d = await apiFetch<{ boards: Board[] }>("/api/boards");
    setBoards(d.boards ?? []);
    setLoadingBoards(false);
    return d.boards ?? [];
  }, []);

  const loadIssues = useCallback(async (bid: string) => {
    const d = await apiFetch<{ issues: Issue[] }>(`/api/boards/${bid}/issues`);
    setIssues((d.issues ?? []).map(i => ({ ...i, tags: i.tags ? (typeof i.tags === "string" ? JSON.parse(i.tags) : i.tags) : [] })));
  }, []);

  useEffect(() => { loadBoards(); }, [loadBoards]);
  useEffect(() => {
    if (!active) return;
    loadIssues(active.id);
    const t = setInterval(() => loadIssues(active.id), 15_000);
    return () => clearInterval(t);
  }, [active, loadIssues]);
  useEffect(() => {
    const fn = (e: KeyboardEvent) => { if (e.key === "Escape") { setDetail(null); setModal(null); } };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, []);

  const selectBoard = async (b: Board) => {
    setActive(b); setDetail(null); setSearch(""); setPriFilter("all");
  };

  // Assignees 목록
  const assignees = Array.from(new Set(issues.map(i => i.assignee).filter(Boolean) as string[]));

  // 필터링
  const filtered = issues.filter(i => {
    if (priFilter !== "all" && i.priority !== priFilter) return false;
    if (typeFilter !== "all" && i.type !== typeFilter) return false;
    if (assigneeFilter !== "all" && i.assignee !== assigneeFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!i.title.toLowerCase().includes(q) && !i.issueKey?.toLowerCase().includes(q) && !i.description?.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const byStatus = (s: Status) => filtered.filter(i => i.status === s);
  const stats = {
    total: issues.length, done: issues.filter(i => i.status === "done").length,
    inProgress: issues.filter(i => i.status === "in_progress").length,
    critical: issues.filter(i => i.priority === "critical" && i.status !== "done").length,
    rate: issues.length > 0 ? Math.round(issues.filter(i => i.status === "done").length / issues.length * 100) : 0,
  };

  const handleStatusChange = useCallback(async (issue: Issue, status: Status) => {
    // Optimistic
    startTransition(() => setIssues(p => p.map(i => i.id === issue.id ? { ...i, status } : i)));
    if (detail?.id === issue.id) setDetail(p => p ? { ...p, status } : null);
    await patch(`/api/boards/${active!.id}/issues/${issue.id}`, { status });
    loadIssues(active!.id);
  }, [active, detail, loadIssues]);

  const handleDelete = useCallback(async (issue: Issue) => {
    if (!confirm(`"${issue.title}" 이슈를 삭제할까요?`)) return;
    setDetail(null);
    setIssues(p => p.filter(i => i.id !== issue.id));
    await del(`/api/boards/${active!.id}/issues/${issue.id}`);
  }, [active]);

  const handleCopyLink = async (token: string) => {
    await navigator.clipboard.writeText(`${window.location.origin}/share/${token}`).catch(() => {});
  };

  return (
    <div className="flex h-[calc(100vh-49px)] bg-[#F4F5F7] overflow-hidden font-sans">

      {/* ── 왼쪽 사이드바 ── */}
      <aside className="w-56 bg-[#0052CC] flex flex-col shrink-0 overflow-y-auto">
        <div className="px-4 py-4 border-b border-blue-600">
          <p className="text-blue-200 text-xs font-semibold uppercase tracking-wider mb-3">내 보드</p>
          {loadingBoards ? (
            <p className="text-blue-300 text-xs">로딩 중...</p>
          ) : boards.length === 0 ? (
            <p className="text-blue-300 text-xs">보드가 없습니다</p>
          ) : (
            <div className="space-y-0.5">
              {boards.map(b => (
                <button key={b.id} onClick={() => selectBoard(b)}
                  className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-all ${active?.id === b.id ? "bg-white text-[#0052CC] font-bold" : "text-white hover:bg-blue-600"}`}>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono bg-blue-500 text-white px-1.5 py-0.5 rounded shrink-0">{b.boardKey}</span>
                    <span className="truncate">{b.name}</span>
                  </div>
                  <p className={`text-xs mt-0.5 ${active?.id === b.id ? "text-blue-500" : "text-blue-300"}`}>{b._count.issues}개 이슈</p>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="p-3 mt-auto">
          <button onClick={() => setModal("create-board")}
            className="w-full flex items-center justify-center gap-1.5 text-xs font-bold bg-white text-[#0052CC] py-2 rounded-lg hover:bg-blue-50 transition-colors">
            + 새 보드 만들기
          </button>
        </div>
      </aside>

      {/* ── 오른쪽 메인 ── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {!active ? (
          /* 보드 선택 전 */
          <div className="flex-1 flex flex-col items-center justify-center text-gray-400 gap-6">
            <div className="text-7xl">📋</div>
            <div className="text-center">
              <h2 className="text-xl font-bold text-gray-600 mb-2">보드를 선택하거나 새로 만드세요</h2>
              <p className="text-sm text-gray-400">이슈를 생성하고 상태를 추적하며 팀과 공유할 수 있습니다</p>
            </div>
            <button onClick={() => setModal("create-board")}
              className="px-6 py-3 bg-[#0052CC] text-white font-bold rounded-lg hover:bg-blue-700 transition-colors text-sm">
              + 첫 번째 보드 만들기
            </button>
          </div>
        ) : (
          <>
            {/* ── 프로젝트 헤더 ── */}
            <div className="bg-white border-b px-6 py-3 flex items-center gap-3 shrink-0">
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <div className="w-8 h-8 bg-[#0052CC] rounded-lg flex items-center justify-center text-white text-xs font-black shrink-0">
                  {active.boardKey.slice(0, 2)}
                </div>
                <div className="min-w-0">
                  <h1 className="text-base font-bold text-gray-800 leading-tight truncate">{active.name}</h1>
                  {active.targetUrl && (
                    <a href={active.targetUrl} target="_blank" rel="noopener noreferrer"
                      className="text-xs text-blue-500 hover:underline truncate block">{active.targetUrl}</a>
                  )}
                </div>
              </div>
              {/* 통계 */}
              <div className="hidden lg:flex items-center gap-4 shrink-0">
                {stats.critical > 0 && (
                  <div className="flex items-center gap-1.5 bg-red-50 border border-red-200 px-3 py-1.5 rounded-lg">
                    <span className="text-xs font-black text-red-700">⛔ Critical {stats.critical}</span>
                  </div>
                )}
                <div className="text-center">
                  <p className="text-xl font-black text-gray-800 leading-none">{stats.total}</p>
                  <p className="text-xs text-gray-400">전체</p>
                </div>
                <div className="text-center">
                  <p className="text-xl font-black text-[#0052CC] leading-none">{stats.inProgress}</p>
                  <p className="text-xs text-gray-400">진행 중</p>
                </div>
                <div className="text-center">
                  <p className="text-xl font-black text-green-600 leading-none">{stats.rate}%</p>
                  <p className="text-xs text-gray-400">완료율</p>
                </div>
              </div>
              {/* 액션 */}
              <div className="flex items-center gap-2 shrink-0">
                <button onClick={() => setModal("import")}
                  className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors">
                  AI 가져오기
                </button>
                <button onClick={() => setModal("share")}
                  className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors">
                  🔗 공유
                </button>
                <button onClick={() => setModal("create-issue")}
                  className="text-xs font-bold px-4 py-1.5 rounded-lg bg-[#0052CC] text-white hover:bg-blue-700 transition-colors">
                  + 이슈 만들기
                </button>
              </div>
            </div>

            {/* ── 서브 탭 + 필터 ── */}
            <div className="bg-white border-b px-6 flex items-center gap-1 shrink-0">
              {(["board", "backlog"] as View[]).map(v => (
                <button key={v} onClick={() => setView(v)}
                  className={`text-sm font-semibold py-2.5 px-3 border-b-2 transition-all ${view === v ? "border-[#0052CC] text-[#0052CC]" : "border-transparent text-gray-500 hover:text-gray-700"}`}>
                  {v === "board" ? "🗂 보드" : "📃 백로그"}
                </button>
              ))}
              <div className="ml-auto flex items-center gap-2 py-2">
                {/* 검색 */}
                <div className="relative">
                  <input value={search} onChange={e => setSearch(e.target.value)} placeholder="이슈 검색..."
                    className="text-xs border border-gray-200 rounded-md pl-7 pr-3 py-1.5 w-40 focus:outline-none focus:ring-2 focus:ring-blue-300" />
                  <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 text-xs">🔍</span>
                  {search && <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 text-xs">✕</button>}
                </div>
                {/* 우선순위 필터 */}
                <select value={priFilter} onChange={e => setPriFilter(e.target.value as Priority | "all")}
                  className="text-xs border border-gray-200 rounded-md px-2 py-1.5 text-gray-600 focus:outline-none">
                  <option value="all">우선순위 전체</option>
                  {(Object.keys(PRIORITY_CFG) as Priority[]).map(p => <option key={p} value={p}>{PRIORITY_CFG[p].icon} {PRIORITY_CFG[p].label}</option>)}
                </select>
                {/* 유형 필터 */}
                <select value={typeFilter} onChange={e => setTypeFilter(e.target.value as IssueType | "all")}
                  className="text-xs border border-gray-200 rounded-md px-2 py-1.5 text-gray-600 focus:outline-none">
                  <option value="all">유형 전체</option>
                  {(Object.keys(TYPE_CFG) as IssueType[]).map(t => <option key={t} value={t}>{TYPE_CFG[t].icon} {TYPE_CFG[t].label}</option>)}
                </select>
                {/* 담당자 필터 */}
                {assignees.length > 0 && (
                  <select value={assigneeFilter} onChange={e => setAssigneeFilter(e.target.value)}
                    className="text-xs border border-gray-200 rounded-md px-2 py-1.5 text-gray-600 focus:outline-none">
                    <option value="all">담당자 전체</option>
                    {assignees.map(a => <option key={a} value={a}>{a}</option>)}
                  </select>
                )}
                <span className="text-xs text-gray-400 whitespace-nowrap">{filtered.length}개</span>
              </div>
            </div>

            {/* ── 뷰 전환 ── */}
            <div className="flex-1 overflow-hidden">
              {view === "board" ? (
                <BoardView issues={filtered} onDetail={setDetail} onStatusChange={handleStatusChange} onCreateIssue={() => setModal("create-issue")} />
              ) : (
                <BacklogView issues={filtered} onDetail={setDetail} onStatusChange={handleStatusChange} />
              )}
            </div>
          </>
        )}
      </div>

      {/* ── 이슈 상세 패널 ── */}
      {detail && active && (
        <IssueDetailPanel
          issue={detail} boardId={active.id}
          onClose={() => setDetail(null)}
          onStatusChange={s => handleStatusChange(detail, s)}
          onDelete={() => handleDelete(detail)}
          onUpdate={async (data) => {
            await patch(`/api/boards/${active.id}/issues/${detail.id}`, data);
            await loadIssues(active.id);
            setDetail(p => p ? { ...p, ...data } : null);
          }}
        />
      )}

      {/* ── 모달들 ── */}
      {modal === "create-board" && (
        <CreateBoardModal
          onClose={() => setModal(null)}
          onCreated={async (b) => {
            const fresh = await loadBoards();
            setActive(fresh.find(fb => fb.id === b.id) ?? b);
            setModal(null);
          }}
        />
      )}
      {modal === "create-issue" && active && (
        <CreateIssueModal
          boardId={active.id}
          onClose={() => setModal(null)}
          onCreated={async () => { await loadIssues(active.id); setModal(null); }}
        />
      )}
      {modal === "import" && active && (
        <ImportModal boardId={active.id} onClose={() => setModal(null)} onImported={async () => { await loadIssues(active.id); setModal(null); }} />
      )}
      {modal === "share" && active && (
        <ShareModal board={active} onCopy={handleCopyLink} onCreated={loadBoards} onClose={() => setModal(null)} />
      )}
    </div>
  );
}

// ─── Board View (Kanban) ──────────────────────────────────────
function BoardView({ issues, onDetail, onStatusChange, onCreateIssue }: {
  issues: Issue[]; onDetail: (i: Issue) => void;
  onStatusChange: (i: Issue, s: Status) => void;
  onCreateIssue: () => void;
}) {
  const cols = COLUMNS.filter(s => s !== "wont_fix");
  const byStatus = (s: Status) => issues.filter(i => i.status === s);

  return (
    <div className="h-full overflow-x-auto p-4">
      <div className="flex gap-3 h-full" style={{ minWidth: `${cols.length * 285}px` }}>
        {cols.map(status => {
          const col = byStatus(status);
          const cfg = STATUS_CFG[status];
          return (
            <div key={status} className="flex flex-col w-[278px] shrink-0">
              {/* 컬럼 헤더 */}
              <div className={`flex items-center gap-2 mb-2 px-3 py-2 rounded-lg bg-white border-l-4 ${cfg.ring}`}>
                <span className="text-xs font-bold text-gray-700 uppercase tracking-wide">{cfg.label}</span>
                <span className="ml-auto text-xs font-black text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">{col.length}</span>
              </div>
              {/* 카드 */}
              <div className="flex-1 overflow-y-auto space-y-2">
                {col.map(issue => (
                  <IssueCard key={issue.id} issue={issue} onClick={() => onDetail(issue)} onStatusChange={s => onStatusChange(issue, s)} />
                ))}
                {status === "todo" && (
                  <button onClick={onCreateIssue}
                    className="w-full text-xs text-gray-400 hover:text-[#0052CC] border border-dashed border-gray-200 hover:border-blue-300 rounded-xl py-3 transition-colors bg-white">
                    + 이슈 추가
                  </button>
                )}
              </div>
            </div>
          );
        })}
        {/* Won't Fix는 접힌 컬럼으로 */}
        <div className="flex flex-col w-14 shrink-0">
          <div className="flex flex-col items-center gap-2 p-2 rounded-lg bg-white border-l-4 border-l-gray-300 h-full">
            <span className="text-xs font-bold text-gray-400 [writing-mode:vertical-lr] rotate-180 tracking-wider py-2">Won't Fix ({issues.filter(i => i.status === "wont_fix").length})</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Backlog View ─────────────────────────────────────────────
function BacklogView({ issues, onDetail, onStatusChange }: {
  issues: Issue[]; onDetail: (i: Issue) => void;
  onStatusChange: (i: Issue, s: Status) => void;
}) {
  const sorted = [...issues].sort((a, b) => {
    const pri = { critical: 0, high: 1, medium: 2, low: 3 };
    return pri[a.priority] - pri[b.priority];
  });
  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {sorted.length === 0 ? (
          <div className="py-20 text-center text-gray-400">
            <p className="text-4xl mb-3">📭</p>
            <p className="font-semibold">이슈가 없습니다</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-gray-50">
                <th className="text-left px-4 py-2.5 text-xs font-bold text-gray-500 uppercase w-24">키</th>
                <th className="text-left px-4 py-2.5 text-xs font-bold text-gray-500 uppercase">제목</th>
                <th className="text-left px-4 py-2.5 text-xs font-bold text-gray-500 uppercase w-28">상태</th>
                <th className="text-left px-4 py-2.5 text-xs font-bold text-gray-500 uppercase w-24">우선순위</th>
                <th className="text-left px-4 py-2.5 text-xs font-bold text-gray-500 uppercase w-24">담당자</th>
                <th className="text-left px-4 py-2.5 text-xs font-bold text-gray-500 uppercase w-20">생성일</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(issue => {
                const pri = PRIORITY_CFG[issue.priority];
                const st = STATUS_CFG[issue.status];
                const ty = TYPE_CFG[issue.type];
                return (
                  <tr key={issue.id} onClick={() => onDetail(issue)}
                    className="border-b last:border-0 hover:bg-blue-50 cursor-pointer transition-colors">
                    <td className="px-4 py-2.5">
                      <span className="font-mono text-xs text-[#0052CC] font-bold">{issue.issueKey ?? "—"}</span>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <span className={`text-sm ${ty.color}`}>{ty.icon}</span>
                        <span className="font-medium text-gray-800 line-clamp-1">{issue.title}</span>
                        {issue.source === "agent" && <span className="text-xs bg-purple-100 text-purple-600 px-1.5 rounded shrink-0">AI</span>}
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      <select value={issue.status}
                        onChange={e => { e.stopPropagation(); onStatusChange(issue, e.target.value as Status); }}
                        onClick={e => e.stopPropagation()}
                        className={`text-xs font-semibold px-2 py-1 rounded-full border-0 cursor-pointer ${st.color}`}>
                        {COLUMNS.map(s => <option key={s} value={s}>{STATUS_CFG[s].label}</option>)}
                      </select>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full ${pri.bg} ${pri.color}`}>
                        {pri.icon} {pri.label}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      {issue.assignee ? (
                        <div className="flex items-center gap-1.5">
                          <div className="w-5 h-5 bg-[#0052CC] rounded-full flex items-center justify-center text-white text-xs font-bold">{avatar(issue.assignee)}</div>
                          <span className="text-xs text-gray-600 truncate">{issue.assignee}</span>
                        </div>
                      ) : <span className="text-xs text-gray-400">미배정</span>}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-gray-400">{relTime(issue.createdAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ─── Issue Card ───────────────────────────────────────────────
function IssueCard({ issue, onClick, onStatusChange }: { issue: Issue; onClick: () => void; onStatusChange: (s: Status) => void; }) {
  const pri = PRIORITY_CFG[issue.priority];
  const ty = TYPE_CFG[issue.type];
  const nextMap: Partial<Record<Status, Status>> = { todo: "in_progress", in_progress: "in_review", in_review: "done" };
  const next = nextMap[issue.status];

  return (
    <div onClick={onClick}
      className="bg-white border border-gray-200 rounded-xl p-3.5 hover:shadow-md hover:border-blue-300 transition-all cursor-pointer group">
      {/* 상단: 이슈키 + 유형 */}
      <div className="flex items-center gap-2 mb-2">
        <span className="font-mono text-xs text-[#0052CC] font-bold">{issue.issueKey ?? "—"}</span>
        <span className={`text-xs ${ty.color}`}>{ty.icon}</span>
        {issue.source === "agent" && <span className="text-xs bg-purple-100 text-purple-600 px-1.5 py-0.5 rounded ml-0.5">AI</span>}
        <span className={`ml-auto inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full ${pri.bg} ${pri.color}`}>
          {pri.icon} {pri.label}
        </span>
      </div>
      {/* 제목 */}
      <p className="text-sm font-semibold text-gray-800 leading-snug line-clamp-2 mb-2.5">{issue.title}</p>
      {/* 스크린샷 */}
      {issue.screenshotUrl && (
        <div className="mb-2.5 rounded-lg overflow-hidden border border-gray-100">
          <img src={issue.screenshotUrl} alt="" className="w-full h-20 object-cover object-top" />
        </div>
      )}
      {/* 하단 */}
      <div className="flex items-center gap-2">
        {issue.assignee ? (
          <div className="flex items-center gap-1.5">
            <div className="w-5 h-5 bg-[#0052CC] rounded-full flex items-center justify-center text-white text-xs font-bold">{avatar(issue.assignee)}</div>
            <span className="text-xs text-gray-500">{issue.assignee}</span>
          </div>
        ) : <span className="text-xs text-gray-400">미배정</span>}
        <span className="text-xs text-gray-400 ml-auto">{relTime(issue.createdAt)}</span>
        {issue._count.comments > 0 && <span className="text-xs text-gray-400">💬{issue._count.comments}</span>}
        {next && (
          <button onClick={e => { e.stopPropagation(); onStatusChange(next); }}
            className="text-xs text-[#0052CC] opacity-0 group-hover:opacity-100 font-semibold hover:underline transition-opacity ml-1">
            → {STATUS_CFG[next].label}
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Issue Detail Panel ───────────────────────────────────────
function IssueDetailPanel({ issue, boardId, onClose, onStatusChange, onDelete, onUpdate }: {
  issue: Issue; boardId: string;
  onClose: () => void; onStatusChange: (s: Status) => void;
  onDelete: () => void; onUpdate: (d: Partial<Issue>) => Promise<void>;
}) {
  const [tab, setTab] = useState<"detail" | "comments" | "history">("detail");
  const [comments, setComments] = useState<Comment[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [comment, setComment] = useState("");
  const [author, setAuthor] = useState(() => typeof window !== "undefined" ? localStorage.getItem("qa_author") ?? "" : "");
  const [posting, setPosting] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleVal, setTitleVal] = useState(issue.title);
  const titleRef = useRef<HTMLInputElement>(null);

  const pri = PRIORITY_CFG[issue.priority];
  const ty = TYPE_CFG[issue.type];

  const loadComments = useCallback(async () => {
    const d = await apiFetch<{ comments: Comment[] }>(`/api/boards/${boardId}/issues/${issue.id}/comments`);
    setComments(d.comments ?? []);
  }, [boardId, issue.id]);

  useEffect(() => { loadComments(); }, [loadComments]);

  const handleComment = async (e: React.FormEvent) => {
    e.preventDefault(); if (!comment.trim()) return;
    setPosting(true);
    if (author) localStorage.setItem("qa_author", author);
    await post(`/api/boards/${boardId}/issues/${issue.id}/comments`, { content: comment, authorName: author || "익명" });
    setComment(""); await loadComments(); setPosting(false);
  };

  const handleTitleSave = async () => {
    if (!titleVal.trim() || titleVal === issue.title) { setEditingTitle(false); return; }
    await onUpdate({ title: titleVal });
    setEditingTitle(false);
  };

  useEffect(() => {
    if (editingTitle) titleRef.current?.focus();
  }, [editingTitle]);

  return (
    <div className="w-[520px] bg-white border-l flex flex-col shrink-0 overflow-hidden shadow-2xl">
      {/* 헤더 */}
      <div className="px-5 py-3 border-b bg-gray-50 flex items-center gap-3 shrink-0">
        <span className="font-mono text-sm font-black text-[#0052CC]">{issue.issueKey ?? "—"}</span>
        <span className={`text-sm ${ty.color}`}>{ty.icon} {ty.label}</span>
        <span className={`ml-auto inline-flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-full ${pri.bg} ${pri.color}`}>
          {pri.icon} {pri.label}
        </span>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg leading-none ml-1">✕</button>
      </div>

      {/* 제목 */}
      <div className="px-5 py-4 border-b shrink-0">
        {editingTitle ? (
          <div className="flex gap-2">
            <input ref={titleRef} value={titleVal} onChange={e => setTitleVal(e.target.value)}
              onBlur={handleTitleSave} onKeyDown={e => e.key === "Enter" && handleTitleSave()}
              className="flex-1 text-base font-bold border border-blue-400 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-300" />
          </div>
        ) : (
          <h2 className="text-base font-bold text-gray-800 leading-snug cursor-pointer hover:text-[#0052CC] transition-colors"
            onClick={() => setEditingTitle(true)}>
            {issue.title}
            <span className="ml-2 text-xs text-gray-300 font-normal">클릭하여 수정</span>
          </h2>
        )}
        <p className="text-xs text-gray-400 mt-1">
          {relTime(issue.createdAt)}
          {issue.reporter && ` · 보고자: ${issue.reporter}`}
          {issue.source === "agent" && " · 🤖 AI 생성"}
        </p>
      </div>

      {/* 상태 + 메타 */}
      <div className="px-5 py-3 border-b bg-gray-50 shrink-0">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">상태</p>
            <select value={issue.status} onChange={e => onStatusChange(e.target.value as Status)}
              className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-300">
              {COLUMNS.map(s => <option key={s} value={s}>{STATUS_CFG[s].label}</option>)}
            </select>
          </div>
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">우선순위</p>
            <select value={issue.priority} onChange={e => onUpdate({ priority: e.target.value as Priority })}
              className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-300">
              {(Object.keys(PRIORITY_CFG) as Priority[]).map(p => <option key={p} value={p}>{PRIORITY_CFG[p].icon} {PRIORITY_CFG[p].label}</option>)}
            </select>
          </div>
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">담당자</p>
            <input defaultValue={issue.assignee ?? ""} placeholder="이름 입력"
              onBlur={e => onUpdate({ assignee: e.target.value || undefined })}
              className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-300" />
          </div>
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">유형</p>
            <select value={issue.type} onChange={e => onUpdate({ type: e.target.value as IssueType })}
              className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-300">
              {(Object.keys(TYPE_CFG) as IssueType[]).map(t => <option key={t} value={t}>{TYPE_CFG[t].icon} {TYPE_CFG[t].label}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* 탭 */}
      <div className="flex border-b shrink-0 bg-white">
        {(["detail", "comments", "history"] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`flex-1 text-xs font-semibold py-2.5 transition-colors ${tab === t ? "border-b-2 border-[#0052CC] text-[#0052CC]" : "text-gray-400 hover:text-gray-600"}`}>
            {t === "detail" ? "상세" : t === "comments" ? `댓글 ${comments.length}` : "이력"}
          </button>
        ))}
      </div>

      {/* 탭 콘텐츠 */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {tab === "detail" && (
          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            {issue.screenshotUrl && (
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">스크린샷</p>
                <a href={issue.screenshotUrl} target="_blank" rel="noopener noreferrer">
                  <img src={issue.screenshotUrl} alt="스크린샷" className="w-full rounded-xl border border-gray-200 hover:opacity-90 transition-opacity" />
                </a>
              </div>
            )}
            {issue.description && (
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">설명</p>
                <p className="text-sm text-gray-600 leading-relaxed whitespace-pre-wrap bg-gray-50 rounded-xl p-3">{issue.description}</p>
              </div>
            )}
            {issue.stepToReproduce && (
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">재현 단계</p>
                <pre className="text-xs bg-gray-50 border border-gray-200 rounded-xl p-3 whitespace-pre-wrap leading-relaxed font-mono">{issue.stepToReproduce}</pre>
              </div>
            )}
            {(issue.expectedResult || issue.actualResult) && (
              <div className="grid grid-cols-2 gap-3">
                {issue.expectedResult && (
                  <div>
                    <p className="text-xs font-bold text-green-600 uppercase tracking-wide mb-2">✅ 기대 결과</p>
                    <p className="text-xs bg-green-50 border border-green-200 rounded-xl p-3 text-green-800 leading-relaxed">{issue.expectedResult}</p>
                  </div>
                )}
                {issue.actualResult && (
                  <div>
                    <p className="text-xs font-bold text-red-600 uppercase tracking-wide mb-2">❌ 실제 결과</p>
                    <p className="text-xs bg-red-50 border border-red-200 rounded-xl p-3 text-red-800 leading-relaxed">{issue.actualResult}</p>
                  </div>
                )}
              </div>
            )}
            {issue.environment && (
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">환경</p>
                <p className="text-xs text-gray-600 bg-gray-50 rounded-xl p-3">{issue.environment}</p>
              </div>
            )}
            {issue.targetUrl && (
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">URL</p>
                <a href={issue.targetUrl} target="_blank" rel="noopener noreferrer"
                  className="text-xs text-[#0052CC] hover:underline break-all">{issue.targetUrl}</a>
              </div>
            )}
          </div>
        )}

        {tab === "comments" && (
          <>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {comments.length === 0
                ? <p className="text-xs text-gray-400 text-center py-10">첫 댓글을 남겨보세요</p>
                : comments.map(c => (
                  <div key={c.id} className="bg-gray-50 rounded-xl p-3">
                    <div className="flex items-center gap-2 mb-1.5">
                      <div className="w-6 h-6 bg-[#0052CC] rounded-full flex items-center justify-center text-white text-xs font-bold">{avatar(c.authorName) ?? "?"}</div>
                      <span className="text-xs font-bold text-gray-700">{c.authorName}</span>
                      <span className="text-xs text-gray-400 ml-auto">{relTime(c.createdAt)}</span>
                    </div>
                    <p className="text-xs text-gray-600 leading-relaxed pl-8">{c.content}</p>
                  </div>
                ))
              }
            </div>
            <form onSubmit={handleComment} className="border-t p-4 space-y-2 shrink-0 bg-white">
              <input value={author} onChange={e => setAuthor(e.target.value)} placeholder="이름 (선택)"
                className="w-full text-xs border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-300" />
              <textarea value={comment} onChange={e => setComment(e.target.value)} placeholder="댓글 입력..." rows={3}
                className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-blue-300" />
              <button type="submit" disabled={posting || !comment.trim()}
                className="w-full text-xs font-bold bg-[#0052CC] text-white py-2 rounded-lg hover:bg-blue-700 disabled:opacity-40 transition-colors">
                {posting ? "등록 중..." : "댓글 등록"}
              </button>
            </form>
          </>
        )}

        {tab === "history" && (
          <div className="flex-1 overflow-y-auto p-4">
            {history.length === 0
              ? <p className="text-xs text-gray-400 text-center py-10">변경 이력이 없습니다</p>
              : history.map(h => (
                <div key={h.id} className="flex items-center gap-2 py-2 border-b border-gray-100 last:border-0 text-xs">
                  <span className="font-semibold text-gray-600">{h.field}</span>
                  <span className="text-gray-400">{h.oldValue || "없음"}</span>
                  <span className="text-gray-400">→</span>
                  <span className="font-bold text-gray-700">{h.newValue}</span>
                  <span className="ml-auto text-gray-400">{relTime(h.createdAt)}</span>
                </div>
              ))
            }
          </div>
        )}
      </div>

      {/* 삭제 */}
      <div className="border-t p-3 bg-white shrink-0">
        <button onClick={onDelete}
          className="w-full text-xs font-semibold text-red-500 border border-red-200 py-2 rounded-xl hover:bg-red-50 transition-colors">
          이슈 삭제
        </button>
      </div>
    </div>
  );
}

// ─── Create Board Modal ───────────────────────────────────────
function CreateBoardModal({ onClose, onCreated }: { onClose: () => void; onCreated: (b: Board) => void }) {
  const [name, setName] = useState("");
  const [key, setKey] = useState("QA");
  const [desc, setDesc] = useState("");
  const [url, setUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { setError("보드 이름을 입력하세요."); return; }
    setSaving(true); setError("");
    try {
      const d = await post("/api/boards", { name, boardKey: key.toUpperCase() || "QA", description: desc || undefined, targetUrl: url || undefined }) as { board?: Board; error?: string };
      if (d.error) { setError(d.error); setSaving(false); return; }
      if (d.board) onCreated(d.board);
    } catch (err) {
      setError(String(err));
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
        <div className="px-6 py-5 border-b flex items-center justify-between">
          <h2 className="text-lg font-black text-gray-800">새 QA 보드 만들기</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-xl">{error}</div>}
          <div>
            <label className="block text-xs font-bold text-gray-600 uppercase tracking-wide mb-1.5">보드 이름 *</label>
            <input value={name} onChange={e => setName(e.target.value)} required autoFocus
              placeholder="예: 회원가입 QA, v2.0 릴리즈 테스트"
              className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-600 uppercase tracking-wide mb-1.5">이슈 키 접두사</label>
            <div className="flex items-center gap-3">
              <input value={key} onChange={e => setKey(e.target.value.toUpperCase().replace(/[^A-Z]/g, ""))}
                maxLength={6} placeholder="QA"
                className="w-24 border border-gray-200 rounded-xl px-4 py-2.5 text-sm font-mono font-bold text-[#0052CC] focus:outline-none focus:ring-2 focus:ring-blue-400" />
              <span className="text-sm text-gray-400">이슈는 <strong className="text-[#0052CC] font-mono">{key || "QA"}-1</strong>, <strong className="text-[#0052CC] font-mono">{key || "QA"}-2</strong>... 형태로 생성됩니다</span>
            </div>
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-600 uppercase tracking-wide mb-1.5">설명</label>
            <input value={desc} onChange={e => setDesc(e.target.value)} placeholder="이 보드에 대한 간단한 설명"
              className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-600 uppercase tracking-wide mb-1.5">테스트 대상 URL</label>
            <input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://example.com"
              className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="flex-1 border border-gray-200 text-gray-600 py-2.5 rounded-xl text-sm font-semibold hover:bg-gray-50">
              취소
            </button>
            <button type="submit" disabled={saving}
              className="flex-1 bg-[#0052CC] text-white py-2.5 rounded-xl text-sm font-bold hover:bg-blue-700 disabled:opacity-50 transition-colors">
              {saving ? "생성 중..." : "보드 만들기"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Create Issue Modal ───────────────────────────────────────
function CreateIssueModal({ boardId, onClose, onCreated }: { boardId: string; onClose: () => void; onCreated: () => void }) {
  const [f, setF] = useState({ title: "", description: "", type: "bug" as IssueType, priority: "medium" as Priority, assignee: "", reporter: "", environment: "", step: "", expected: "", actual: "", url: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const u = (k: string, v: string) => setF(p => ({ ...p, [k]: v }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!f.title.trim()) { setError("제목을 입력하세요."); return; }
    setSaving(true); setError("");
    try {
      const d = await post(`/api/boards/${boardId}/issues`, {
        title: f.title, description: f.description || undefined,
        type: f.type, priority: f.priority,
        assignee: f.assignee || undefined, reporter: f.reporter || undefined,
        environment: f.environment || undefined,
        stepToReproduce: f.step || undefined,
        expectedResult: f.expected || undefined,
        actualResult: f.actual || undefined,
        targetUrl: f.url || undefined,
      }) as { error?: string };
      if (d.error) { setError(d.error); setSaving(false); return; }
      onCreated();
    } catch (err) {
      setError(String(err)); setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl my-4" onClick={e => e.stopPropagation()}>
        <div className="px-6 py-5 border-b flex items-center justify-between sticky top-0 bg-white rounded-t-2xl z-10">
          <h2 className="text-lg font-black text-gray-800">이슈 만들기</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-xl">{error}</div>}
          {/* 유형 + 우선순위 */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-gray-600 uppercase tracking-wide mb-1.5">유형</label>
              <div className="flex gap-1.5 flex-wrap">
                {(Object.keys(TYPE_CFG) as IssueType[]).map(t => (
                  <button key={t} type="button" onClick={() => u("type", t)}
                    className={`flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-lg border transition-all ${f.type === t ? "border-[#0052CC] bg-blue-50 text-[#0052CC]" : "border-gray-200 text-gray-500 hover:border-gray-300"}`}>
                    {TYPE_CFG[t].icon} {TYPE_CFG[t].label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-600 uppercase tracking-wide mb-1.5">우선순위</label>
              <div className="flex gap-1.5">
                {(Object.keys(PRIORITY_CFG) as Priority[]).map(p => (
                  <button key={p} type="button" onClick={() => u("priority", p)}
                    className={`flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-lg border transition-all ${f.priority === p ? `border-current ${PRIORITY_CFG[p].bg} ${PRIORITY_CFG[p].color}` : "border-gray-200 text-gray-500 hover:border-gray-300"}`}>
                    {PRIORITY_CFG[p].icon} {PRIORITY_CFG[p].label}
                  </button>
                ))}
              </div>
            </div>
          </div>
          {/* 제목 */}
          <div>
            <label className="block text-xs font-bold text-gray-600 uppercase tracking-wide mb-1.5">제목 *</label>
            <input value={f.title} onChange={e => u("title", e.target.value)} required autoFocus
              placeholder="이슈를 간단히 설명해 주세요"
              className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
          </div>
          {/* 설명 */}
          <div>
            <label className="block text-xs font-bold text-gray-600 uppercase tracking-wide mb-1.5">설명</label>
            <textarea value={f.description} onChange={e => u("description", e.target.value)} rows={3}
              placeholder="이슈에 대한 상세 설명을 입력하세요"
              className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-400" />
          </div>
          {/* 재현 단계 */}
          <div>
            <label className="block text-xs font-bold text-gray-600 uppercase tracking-wide mb-1.5">재현 단계</label>
            <textarea value={f.step} onChange={e => u("step", e.target.value)} rows={4}
              placeholder={"1. 로그인 페이지 접속\n2. 이메일 / 비밀번호 입력\n3. 로그인 버튼 클릭\n4. 결과 확인"}
              className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-400 font-mono" />
          </div>
          {/* 기대 / 실제 */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-green-600 uppercase tracking-wide mb-1.5">✅ 기대 결과</label>
              <textarea value={f.expected} onChange={e => u("expected", e.target.value)} rows={2} placeholder="정상 동작 설명"
                className="w-full border border-green-200 rounded-xl px-4 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-green-300" />
            </div>
            <div>
              <label className="block text-xs font-bold text-red-600 uppercase tracking-wide mb-1.5">❌ 실제 결과</label>
              <textarea value={f.actual} onChange={e => u("actual", e.target.value)} rows={2} placeholder="실제 발생한 문제"
                className="w-full border border-red-200 rounded-xl px-4 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-red-300" />
            </div>
          </div>
          {/* 담당자 / 환경 / URL */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-bold text-gray-600 uppercase tracking-wide mb-1.5">담당자</label>
              <input value={f.assignee} onChange={e => u("assignee", e.target.value)} placeholder="이름"
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-600 uppercase tracking-wide mb-1.5">보고자</label>
              <input value={f.reporter} onChange={e => u("reporter", e.target.value)} placeholder="이름"
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-600 uppercase tracking-wide mb-1.5">환경</label>
              <input value={f.environment} onChange={e => u("environment", e.target.value)} placeholder="Chrome / macOS"
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-600 uppercase tracking-wide mb-1.5">관련 URL</label>
            <input value={f.url} onChange={e => u("url", e.target.value)} placeholder="https://example.com/page"
              className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="flex-1 border border-gray-200 text-gray-600 py-2.5 rounded-xl text-sm font-semibold hover:bg-gray-50">
              취소
            </button>
            <button type="submit" disabled={saving}
              className="flex-1 bg-[#0052CC] text-white py-2.5 rounded-xl text-sm font-bold hover:bg-blue-700 disabled:opacity-50 transition-colors">
              {saving ? "생성 중..." : "이슈 만들기"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Import Modal ─────────────────────────────────────────────
function ImportModal({ boardId, onClose, onImported }: { boardId: string; onClose: () => void; onImported: () => void }) {
  const [reports, setReports] = useState<SavedReport[]>([]);
  const [selected, setSelected] = useState<SavedReport | null>(null);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [importing, setImporting] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch<{ reports: SavedReport[] }>("/api/reports/list").then(d => { setReports(d.reports ?? []); setLoading(false); });
  }, []);

  const selectReport = (r: SavedReport) => { setSelected(r); setChecked(new Set(r.findings.map((_, i) => i))); };
  const toggleAll = () => setChecked(checked.size === selected!.findings.length ? new Set() : new Set(selected!.findings.map((_, i) => i)));
  const toggle = (i: number) => setChecked(p => { const n = new Set(p); n.has(i) ? n.delete(i) : n.add(i); return n; });

  const handleImport = async () => {
    if (!selected || checked.size === 0) return;
    setImporting(true);
    const findings = Array.from(checked).map(i => selected.findings[i]);
    await post(`/api/boards/${boardId}/issues/import`, { findings: findings.map(f => ({ ...f, targetUrl: selected.targetUrl })) });
    onImported();
  };

  const sevToPri = (s: string) => ({ critical: "⛔", high: "🔴", medium: "🟡", low: "🔵" })[s] ?? "🟡";

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-6 py-5 border-b flex items-center justify-between shrink-0">
          <h2 className="text-lg font-black text-gray-800">AI 테스트 결과 가져오기</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading ? <p className="text-center text-gray-400 py-10">로딩 중...</p>
          : reports.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              <p className="text-3xl mb-3">📭</p>
              <p className="font-semibold">저장된 리포트가 없습니다</p>
              <p className="text-xs mt-1">Auto Agent 실행 후 리포트를 저장하면 이슈로 가져올 수 있습니다</p>
            </div>
          ) : !selected ? (
            <div className="space-y-2">
              {reports.map(r => (
                <button key={r.id} onClick={() => selectReport(r)}
                  className="w-full text-left p-4 border border-gray-200 rounded-xl hover:border-[#0052CC] hover:bg-blue-50 transition-all group">
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-gray-800 truncate">{r.name}</p>
                      <p className="text-xs text-gray-400 truncate mt-0.5">{r.targetUrl}</p>
                      <div className="flex items-center gap-2 mt-1.5">
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${r.riskLevel === "critical" ? "bg-red-100 text-red-700" : r.riskLevel === "high" ? "bg-orange-100 text-orange-700" : "bg-yellow-100 text-yellow-700"}`}>
                          {r.riskLevel} risk
                        </span>
                        <span className="text-xs text-gray-400">통과율 {Math.round(r.passRate)}%</span>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-black text-red-600">{r.findingCount}개 발견</p>
                      <p className="text-xs text-gray-400">{new Date(r.savedAt).toLocaleDateString("ko-KR")}</p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <button onClick={() => setSelected(null)} className="text-xs text-[#0052CC] hover:underline">← 뒤로</button>
                <span className="text-sm font-bold text-gray-700 truncate flex-1">{selected.name}</span>
                <button onClick={toggleAll} className="text-xs text-[#0052CC] hover:underline shrink-0">
                  {checked.size === selected.findings.length ? "전체 해제" : "전체 선택"}
                </button>
              </div>
              <div className="space-y-2">
                {selected.findings.map((f, i) => (
                  <label key={i} onClick={() => toggle(i)}
                    className={`flex items-start gap-3 p-3.5 border rounded-xl cursor-pointer transition-all ${checked.has(i) ? "border-[#0052CC] bg-blue-50" : "border-gray-200 hover:border-gray-300"}`}>
                    <input type="checkbox" checked={checked.has(i)} onChange={() => toggle(i)} className="mt-0.5 accent-blue-600" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-sm">{sevToPri(f.severity)}</span>
                        <span className="text-xs text-gray-400 capitalize">{f.severity}</span>
                      </div>
                      <p className="text-sm font-semibold text-gray-800">{f.title}</p>
                      {f.description && <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{f.description}</p>}
                    </div>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>
        {selected && (
          <div className="px-6 py-4 border-t bg-gray-50 flex items-center gap-3 shrink-0">
            <span className="text-sm text-gray-600 font-semibold">{checked.size}개 선택됨</span>
            <button onClick={onClose} className="flex-1 border border-gray-200 text-gray-600 py-2 rounded-xl text-sm hover:bg-gray-100">취소</button>
            <button onClick={handleImport} disabled={importing || checked.size === 0}
              className="flex-1 bg-[#0052CC] text-white py-2 rounded-xl text-sm font-bold hover:bg-blue-700 disabled:opacity-40 transition-colors">
              {importing ? "가져오는 중..." : `${checked.size}개 이슈로 추가`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Share Modal ──────────────────────────────────────────────
function ShareModal({ board, onCopy, onCreated, onClose }: { board: Board; onCopy: (t: string) => void; onCreated: () => void; onClose: () => void; }) {
  const [label, setLabel] = useState("");
  const [creating, setCreating] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const handleCopy = async (token: string, id: string) => {
    onCopy(token);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleCreate = async () => {
    setCreating(true);
    const d = await post(`/api/boards/${board.id}/share`, { label: label || undefined }) as { link?: ShareLink };
    if (d.link) { await onCreated(); setLabel(""); }
    setCreating(false);
  };

  const origin = typeof window !== "undefined" ? window.location.origin : "";

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
        <div className="px-6 py-5 border-b flex items-center justify-between">
          <h2 className="text-lg font-black text-gray-800">공유 링크</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>
        <div className="px-6 py-5 space-y-4">
          {board.shareLinks.length > 0 && (
            <div className="space-y-2">
              {board.shareLinks.map(link => (
                <div key={link.id} className="flex items-center gap-3 bg-gray-50 border border-gray-200 rounded-xl p-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold text-gray-700">{link.label ?? "공유 링크"}</p>
                    <p className="text-xs text-gray-400 truncate">{origin}/share/{link.publicToken}</p>
                    <p className="text-xs text-gray-400 mt-0.5">👁 {link.viewCount}회 조회</p>
                  </div>
                  <button onClick={() => handleCopy(link.publicToken, link.id)}
                    className={`text-xs font-bold px-3 py-1.5 rounded-lg transition-all ${copiedId === link.id ? "bg-green-500 text-white" : "bg-[#0052CC] text-white hover:bg-blue-700"}`}>
                    {copiedId === link.id ? "✅ 복사됨" : "복사"}
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="border-t pt-4">
            <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">새 공유 링크 생성</p>
            <div className="flex gap-2">
              <input value={label} onChange={e => setLabel(e.target.value)} placeholder="링크 이름 (선택사항)"
                className="flex-1 text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400" />
              <button onClick={handleCreate} disabled={creating}
                className="text-sm font-bold bg-[#0052CC] text-white px-4 py-2 rounded-xl hover:bg-blue-700 disabled:opacity-50">
                {creating ? "..." : "생성"}
              </button>
            </div>
            <p className="text-xs text-gray-400 mt-2">공유 링크를 받은 누구나 로그인 없이 이 보드를 볼 수 있습니다.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
