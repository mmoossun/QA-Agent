"use client";

import { useEffect, useState, useCallback, useRef } from "react";

// ─── Types ────────────────────────────────────────────────────
type Severity = "critical" | "major" | "minor" | "trivial";
type Status   = "open" | "in_progress" | "resolved" | "wont_fix";
type IssueType = "bug" | "design" | "content" | "accessibility" | "spec";

interface Comment { id: string; content: string; authorName: string; createdAt: string; }
interface IssueHistory { id: string; field: string; oldValue?: string; newValue?: string; createdAt: string; }

interface Issue {
  id: string; title: string; description?: string;
  type: IssueType; severity: Severity; status: Status;
  source: string; screenshotUrl?: string; targetUrl?: string;
  stepToReproduce?: string; expectedResult?: string; actualResult?: string;
  tags: string[]; createdAt: string; updatedAt: string;
  _count: { comments: number };
}

interface Board {
  id: string; name: string; description?: string; targetUrl?: string;
  createdAt: string; _count: { issues: number };
  shareLinks: { id: string; publicToken: string; label?: string; viewCount: number; createdAt: string }[];
}

interface SavedFinding {
  title: string; description: string; severity: string;
  rootCause: string; reproductionSteps: string; recommendation: string;
  screenshotPath?: string;
}
interface SavedReport {
  id: string; name: string; targetUrl: string; status: string;
  riskLevel: string; passRate: number; savedAt: string;
  findingCount: number; findings: SavedFinding[];
}

// ─── Constants ────────────────────────────────────────────────
const SEV: Record<Severity, { label: string; bg: string; text: string; dot: string }> = {
  critical: { label: "Critical", bg: "bg-red-100",    text: "text-red-700",    dot: "bg-red-500"    },
  major:    { label: "Major",    bg: "bg-orange-100", text: "text-orange-700", dot: "bg-orange-500" },
  minor:    { label: "Minor",    bg: "bg-yellow-100", text: "text-yellow-700", dot: "bg-yellow-400" },
  trivial:  { label: "Trivial",  bg: "bg-gray-100",   text: "text-gray-500",   dot: "bg-gray-300"   },
};

const STATUS: Record<Status, { label: string; color: string }> = {
  open:        { label: "Open",        color: "text-red-600 border-red-300 bg-red-50"        },
  in_progress: { label: "In Progress", color: "text-yellow-700 border-yellow-300 bg-yellow-50" },
  resolved:    { label: "Resolved",    color: "text-green-700 border-green-300 bg-green-50"  },
  wont_fix:    { label: "Won't Fix",   color: "text-gray-500 border-gray-300 bg-gray-50"     },
};

const TYPE_LABEL: Record<string, string> = {
  bug: "🐛 버그", design: "🎨 디자인", content: "📝 콘텐츠",
  accessibility: "♿ 접근성", spec: "📋 스펙",
};

const COLUMNS: Status[] = ["open", "in_progress", "resolved", "wont_fix"];

function relTime(iso: string) {
  const d = Date.now() - new Date(iso).getTime();
  const m = Math.floor(d / 60000);
  if (m < 1) return "방금";
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  return `${Math.floor(h / 24)}일 전`;
}

// ─── API helpers ──────────────────────────────────────────────
const api = {
  boards: () => fetch("/api/boards").then(r => r.json()),
  createBoard: (b: object) => fetch("/api/boards", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }).then(r => r.json()),
  deleteBoard: (id: string) => fetch(`/api/boards/${id}`, { method: "DELETE" }),
  issues: (bid: string) => fetch(`/api/boards/${bid}/issues`).then(r => r.json()),
  createIssue: (bid: string, data: object) => fetch(`/api/boards/${bid}/issues`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }).then(r => r.json()),
  updateIssue: (bid: string, iid: string, data: object) => fetch(`/api/boards/${bid}/issues/${iid}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }).then(r => r.json()),
  deleteIssue: (bid: string, iid: string) => fetch(`/api/boards/${bid}/issues/${iid}`, { method: "DELETE" }),
  importIssues: (bid: string, findings: SavedFinding[], targetUrl?: string) =>
    fetch(`/api/boards/${bid}/issues/import`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ findings: findings.map(f => ({ ...f, targetUrl })) }) }).then(r => r.json()),
  createShare: (bid: string, label?: string) => fetch(`/api/boards/${bid}/share`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ label }) }).then(r => r.json()),
  comments: (bid: string, iid: string) => fetch(`/api/boards/${bid}/issues/${iid}/comments`).then(r => r.json()),
  addComment: (bid: string, iid: string, content: string, authorName: string) =>
    fetch(`/api/boards/${bid}/issues/${iid}/comments`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content, authorName }) }).then(r => r.json()),
  reports: () => fetch("/api/reports/list").then(r => r.json()),
};

// ─── Main Page ────────────────────────────────────────────────
export default function BoardPage() {
  const [boards, setBoards] = useState<Board[]>([]);
  const [activeBoard, setActiveBoard] = useState<Board | null>(null);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [sevFilter, setSevFilter] = useState<Severity | "all">("all");
  const [typeFilter, setTypeFilter] = useState<IssueType | "all">("all");
  const [detailIssue, setDetailIssue] = useState<Issue | null>(null);
  const [modal, setModal] = useState<"board" | "issue" | "import" | "share" | null>(null);
  const [copied, setCopied] = useState(false);

  const loadBoards = useCallback(async () => {
    const d = await api.boards();
    setBoards(d.boards ?? []);
    setLoading(false);
  }, []);

  const loadIssues = useCallback(async (boardId: string) => {
    const d = await api.issues(boardId);
    setIssues(d.issues ?? []);
  }, []);

  useEffect(() => { loadBoards(); }, [loadBoards]);

  useEffect(() => {
    if (!activeBoard) return;
    loadIssues(activeBoard.id);
    const t = setInterval(() => loadIssues(activeBoard.id), 15_000);
    return () => clearInterval(t);
  }, [activeBoard, loadIssues]);

  // Esc to close detail/modal
  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setDetailIssue(null); setModal(null); }
    };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, []);

  // 필터링된 이슈
  const filtered = issues.filter(i => {
    if (sevFilter !== "all" && i.severity !== sevFilter) return false;
    if (typeFilter !== "all" && i.type !== typeFilter) return false;
    if (search && !i.title.toLowerCase().includes(search.toLowerCase()) &&
        !i.description?.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const byStatus = (s: Status) => filtered.filter(i => i.status === s);
  const stats = {
    total: issues.length,
    open: issues.filter(i => i.status === "open").length,
    inProgress: issues.filter(i => i.status === "in_progress").length,
    resolved: issues.filter(i => i.status === "resolved").length,
    critical: issues.filter(i => i.severity === "critical" && i.status !== "resolved").length,
    rate: issues.length > 0 ? Math.round(issues.filter(i => i.status === "resolved").length / issues.length * 100) : 0,
  };

  const handleStatusChange = async (issue: Issue, status: Status) => {
    await api.updateIssue(activeBoard!.id, issue.id, { status });
    await loadIssues(activeBoard!.id);
    if (detailIssue?.id === issue.id) setDetailIssue(prev => prev ? { ...prev, status } : null);
  };

  const handleDeleteIssue = async (issue: Issue) => {
    if (!confirm(`"${issue.title}" 이슈를 삭제할까요?`)) return;
    await api.deleteIssue(activeBoard!.id, issue.id);
    setDetailIssue(null);
    loadIssues(activeBoard!.id);
  };

  const handleDeleteBoard = async (board: Board) => {
    if (!confirm(`"${board.name}" 보드를 삭제할까요? 이슈도 모두 삭제됩니다.`)) return;
    await api.deleteBoard(board.id);
    setActiveBoard(null);
    setIssues([]);
    loadBoards();
  };

  const handleCopyLink = async (token: string) => {
    await navigator.clipboard.writeText(`${window.location.origin}/share/${token}`).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // ── Render ─────────────────────────────────────────────────
  return (
    <div className="flex h-[calc(100vh-49px)] bg-gray-50 overflow-hidden">

      {/* ── 사이드바 ── */}
      <aside className="w-60 bg-white border-r flex flex-col shrink-0">
        <div className="p-4 border-b">
          <p className="text-xs text-gray-400 font-medium uppercase tracking-wider">QA 보드</p>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
          {loading
            ? <p className="text-xs text-gray-400 p-3">불러오는 중...</p>
            : boards.length === 0
            ? <p className="text-xs text-gray-400 p-3">보드가 없습니다</p>
            : boards.map(b => (
              <button key={b.id} onClick={() => setActiveBoard(b)}
                className={`w-full text-left px-3 py-2.5 rounded-lg transition-all group ${activeBoard?.id === b.id ? "bg-blue-50 border border-blue-200" : "hover:bg-gray-50 border border-transparent"}`}>
                <div className="flex items-center gap-1">
                  <span className={`flex-1 text-sm font-semibold truncate ${activeBoard?.id === b.id ? "text-blue-700" : "text-gray-700"}`}>
                    {b.name}
                  </span>
                  <span className="text-xs text-gray-400 shrink-0">{b._count.issues}</span>
                </div>
                {b.description && <p className="text-xs text-gray-400 truncate mt-0.5">{b.description}</p>}
              </button>
            ))
          }
        </div>
        <div className="p-3 border-t">
          <button onClick={() => setModal("board")}
            className="w-full flex items-center justify-center gap-1.5 text-sm font-semibold bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700 transition-colors">
            <span>+</span> 새 보드
          </button>
        </div>
      </aside>

      {/* ── 메인 ── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {!activeBoard ? (
          <div className="flex-1 flex flex-col items-center justify-center text-gray-400 gap-4">
            <div className="text-6xl">📋</div>
            <div className="text-center">
              <p className="text-lg font-semibold text-gray-600">보드를 선택하거나 새로 만드세요</p>
              <p className="text-sm mt-1">이슈를 생성하고 팀과 공유할 수 있습니다.</p>
            </div>
            <button onClick={() => setModal("board")}
              className="mt-2 px-5 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-700">
              + 첫 번째 보드 만들기
            </button>
          </div>
        ) : (
          <>
            {/* 헤더 */}
            <div className="bg-white border-b px-5 py-3 shrink-0">
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h2 className="text-base font-bold text-gray-800 truncate">{activeBoard.name}</h2>
                    {activeBoard.targetUrl && (
                      <a href={activeBoard.targetUrl} target="_blank" rel="noopener noreferrer"
                        className="text-xs text-blue-500 hover:underline truncate max-w-[200px]">
                        {activeBoard.targetUrl}
                      </a>
                    )}
                  </div>
                  {activeBoard.description && <p className="text-xs text-gray-400 mt-0.5">{activeBoard.description}</p>}
                </div>

                {/* 통계 칩 */}
                <div className="hidden md:flex items-center gap-3 shrink-0">
                  {stats.critical > 0 && (
                    <div className="flex items-center gap-1 bg-red-50 border border-red-200 rounded-lg px-2.5 py-1">
                      <span className="w-1.5 h-1.5 bg-red-500 rounded-full" />
                      <span className="text-xs font-bold text-red-700">Critical {stats.critical}</span>
                    </div>
                  )}
                  <div className="text-center">
                    <p className="text-lg font-black text-gray-800 leading-none">{stats.total}</p>
                    <p className="text-xs text-gray-400">전체</p>
                  </div>
                  <div className="text-center">
                    <p className="text-lg font-black text-green-600 leading-none">{stats.rate}%</p>
                    <p className="text-xs text-gray-400">해결률</p>
                  </div>
                </div>

                {/* 액션 버튼 */}
                <div className="flex items-center gap-1.5 shrink-0">
                  <button onClick={() => setModal("import")}
                    className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors">
                    AI 결과 가져오기
                  </button>
                  <button onClick={() => setModal("share")}
                    className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors">
                    🔗 공유
                  </button>
                  <button onClick={() => setModal("issue")}
                    className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors">
                    + 이슈
                  </button>
                  <button onClick={() => handleDeleteBoard(activeBoard)}
                    className="text-xs text-gray-400 hover:text-red-500 px-2 py-1.5 rounded-lg hover:bg-red-50 transition-colors">
                    삭제
                  </button>
                </div>
              </div>

              {/* 진행률 바 */}
              <div className="mt-2.5 flex items-center gap-2">
                <div className="flex-1 bg-gray-100 rounded-full h-1.5">
                  <div className="bg-green-500 h-1.5 rounded-full transition-all duration-500"
                    style={{ width: `${stats.rate}%` }} />
                </div>
                <span className="text-xs text-gray-400 shrink-0">{stats.resolved}/{stats.total}</span>
              </div>
            </div>

            {/* 필터 툴바 */}
            <div className="bg-white border-b px-5 py-2 flex items-center gap-2 shrink-0 flex-wrap">
              <div className="relative">
                <input value={search} onChange={e => setSearch(e.target.value)}
                  placeholder="이슈 검색..."
                  className="text-xs border border-gray-200 rounded-lg pl-7 pr-3 py-1.5 w-44 focus:outline-none focus:border-blue-400" />
                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 text-xs">🔍</span>
                {search && (
                  <button onClick={() => setSearch("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs">✕</button>
                )}
              </div>
              <div className="w-px h-4 bg-gray-200" />
              {(["all", "critical", "major", "minor", "trivial"] as const).map(s => (
                <button key={s} onClick={() => setSevFilter(s)}
                  className={`text-xs font-semibold px-2.5 py-1 rounded-full transition-all ${sevFilter === s ? "bg-gray-800 text-white" : "text-gray-500 hover:bg-gray-100"}`}>
                  {s === "all" ? "전체" : SEV[s].label}
                  {s !== "all" && <span className="ml-1 opacity-60">{issues.filter(i => i.severity === s).length}</span>}
                </button>
              ))}
              <div className="w-px h-4 bg-gray-200" />
              <select value={typeFilter} onChange={e => setTypeFilter(e.target.value as IssueType | "all")}
                className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 text-gray-600 focus:outline-none">
                <option value="all">모든 유형</option>
                {Object.entries(TYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              <span className="ml-auto text-xs text-gray-400">{filtered.length}개 표시 중</span>
            </div>

            {/* Kanban */}
            <div className="flex-1 overflow-x-auto p-4">
              <div className="flex gap-3 h-full" style={{ minWidth: `${COLUMNS.length * 280}px` }}>
                {COLUMNS.map(status => {
                  const col = byStatus(status);
                  const st = STATUS[status];
                  return (
                    <div key={status} className="flex flex-col w-[272px] shrink-0">
                      {/* 컬럼 헤더 */}
                      <div className="flex items-center gap-2 mb-2 px-1">
                        <h3 className="text-sm font-bold text-gray-700">{st.label}</h3>
                        <span className="ml-auto text-xs font-bold text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
                          {col.length}
                        </span>
                      </div>

                      {/* 카드 리스트 */}
                      <div className="flex-1 overflow-y-auto space-y-2 pr-0.5">
                        {col.length === 0 ? (
                          <div className="border-2 border-dashed border-gray-200 rounded-xl p-6 text-center text-xs text-gray-400">
                            이슈 없음
                          </div>
                        ) : (
                          col.map(issue => (
                            <IssueCard key={issue.id} issue={issue}
                              onClick={() => setDetailIssue(issue)}
                              onStatusChange={s => handleStatusChange(issue, s)} />
                          ))
                        )}
                      </div>

                      {/* 하단 빠른 추가 */}
                      {status === "open" && (
                        <button onClick={() => setModal("issue")}
                          className="mt-2 w-full text-xs text-gray-400 hover:text-blue-600 border border-dashed border-gray-200 hover:border-blue-300 rounded-lg py-2 transition-colors">
                          + 이슈 추가
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </div>

      {/* ── 이슈 상세 패널 ── */}
      {detailIssue && activeBoard && (
        <IssueDetailPanel
          issue={detailIssue}
          boardId={activeBoard.id}
          onClose={() => setDetailIssue(null)}
          onStatusChange={s => handleStatusChange(detailIssue, s)}
          onDelete={() => handleDeleteIssue(detailIssue)}
          onUpdate={async (data) => {
            await api.updateIssue(activeBoard.id, detailIssue.id, data);
            await loadIssues(activeBoard.id);
            setDetailIssue(prev => prev ? { ...prev, ...data } : null);
          }}
        />
      )}

      {/* ── 모달들 ── */}
      {modal === "board" && (
        <BoardModal
          onClose={() => setModal(null)}
          onCreated={async (b) => { await loadBoards(); setActiveBoard(b); setModal(null); }}
        />
      )}
      {modal === "issue" && activeBoard && (
        <IssueModal
          boardId={activeBoard.id}
          onClose={() => setModal(null)}
          onCreated={async () => { await loadIssues(activeBoard.id); setModal(null); }}
        />
      )}
      {modal === "import" && activeBoard && (
        <ImportModal
          boardId={activeBoard.id}
          onClose={() => setModal(null)}
          onImported={async () => { await loadIssues(activeBoard.id); setModal(null); }}
        />
      )}
      {modal === "share" && activeBoard && (
        <ShareModal
          board={activeBoard}
          copied={copied}
          onCopy={handleCopyLink}
          onCreated={async () => { await loadBoards(); }}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}

// ─── IssueCard ────────────────────────────────────────────────
function IssueCard({ issue, onClick, onStatusChange }: {
  issue: Issue;
  onClick: () => void;
  onStatusChange: (s: Status) => void;
}) {
  const sev = SEV[issue.severity];
  const nextStatus: Record<Status, Status | null> = {
    open: "in_progress", in_progress: "resolved", resolved: null, wont_fix: null,
  };
  const next = nextStatus[issue.status];

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-3 hover:border-blue-300 hover:shadow-sm transition-all cursor-pointer group"
      onClick={onClick}>
      {/* 상단: 심각도 + 유형 */}
      <div className="flex items-center gap-1.5 mb-2">
        <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full ${sev.bg} ${sev.text}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${sev.dot}`} />
          {sev.label}
        </span>
        <span className="text-xs text-gray-400">{TYPE_LABEL[issue.type]?.split(" ")[0]}</span>
        {issue.source === "agent" && (
          <span className="text-xs bg-purple-50 text-purple-600 px-1.5 py-0.5 rounded ml-auto">AI</span>
        )}
      </div>

      {/* 제목 */}
      <p className="text-sm font-semibold text-gray-800 leading-snug line-clamp-2 mb-2">{issue.title}</p>

      {/* 스크린샷 썸네일 */}
      {issue.screenshotUrl && (
        <div className="mb-2 rounded-lg overflow-hidden border border-gray-100">
          <img src={issue.screenshotUrl} alt="스크린샷" className="w-full h-24 object-cover object-top" />
        </div>
      )}

      {/* 하단 */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-400">{relTime(issue.createdAt)}</span>
        {issue._count.comments > 0 && (
          <span className="text-xs text-gray-400">💬 {issue._count.comments}</span>
        )}
        {next && (
          <button
            onClick={e => { e.stopPropagation(); onStatusChange(next); }}
            className="ml-auto text-xs text-blue-600 opacity-0 group-hover:opacity-100 transition-opacity font-medium hover:underline">
            → {STATUS[next].label}
          </button>
        )}
      </div>
    </div>
  );
}

// ─── IssueDetailPanel ─────────────────────────────────────────
function IssueDetailPanel({ issue, boardId, onClose, onStatusChange, onDelete, onUpdate }: {
  issue: Issue; boardId: string;
  onClose: () => void;
  onStatusChange: (s: Status) => void;
  onDelete: () => void;
  onUpdate: (data: Partial<Issue>) => Promise<void>;
}) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [history, setHistory] = useState<IssueHistory[]>([]);
  const [comment, setComment] = useState("");
  const [author, setAuthor] = useState(() => typeof window !== "undefined" ? localStorage.getItem("qa_author") ?? "" : "");
  const [tab, setTab] = useState<"detail" | "comments" | "history">("detail");
  const [posting, setPosting] = useState(false);
  const commentRef = useRef<HTMLTextAreaElement>(null);

  const loadComments = useCallback(async () => {
    const d = await api.comments(boardId, issue.id);
    setComments(d.comments ?? []);
  }, [boardId, issue.id]);

  useEffect(() => {
    loadComments();
    // history는 API 없어서 생략 (추후 추가)
  }, [loadComments]);

  const handleComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!comment.trim()) return;
    setPosting(true);
    if (author) localStorage.setItem("qa_author", author);
    await api.addComment(boardId, issue.id, comment, author || "익명");
    setComment("");
    await loadComments();
    setPosting(false);
  };

  const sev = SEV[issue.severity];

  return (
    <div className="w-96 bg-white border-l flex flex-col shrink-0 overflow-hidden shadow-xl">
      {/* 헤더 */}
      <div className="px-5 py-3 border-b flex items-center gap-2 shrink-0">
        <span className={`inline-flex items-center gap-1 text-xs font-bold px-2 py-1 rounded-full ${sev.bg} ${sev.text}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${sev.dot}`} />{sev.label}
        </span>
        <span className="text-xs text-gray-400">{TYPE_LABEL[issue.type]}</span>
        <button onClick={onClose} className="ml-auto text-gray-400 hover:text-gray-600 text-lg leading-none">✕</button>
      </div>

      {/* 제목 */}
      <div className="px-5 py-3 border-b shrink-0">
        <h3 className="text-sm font-bold text-gray-800 leading-snug">{issue.title}</h3>
        <p className="text-xs text-gray-400 mt-1">{relTime(issue.createdAt)} · {issue.source === "agent" ? "🤖 AI 생성" : "✏️ 수동 작성"}</p>
      </div>

      {/* 상태 변경 */}
      <div className="px-5 py-2.5 border-b bg-gray-50 shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-gray-500">상태</span>
          <div className="flex gap-1.5 flex-wrap">
            {(COLUMNS).map(s => (
              <button key={s} onClick={() => onStatusChange(s)}
                className={`text-xs font-semibold px-2.5 py-1 rounded-full border transition-all ${
                  issue.status === s ? STATUS[s].color + " font-bold" : "border-gray-200 text-gray-400 hover:border-gray-300"
                }`}>
                {STATUS[s].label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 탭 */}
      <div className="flex border-b shrink-0">
        {(["detail", "comments", "history"] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`flex-1 text-xs font-semibold py-2 transition-colors ${tab === t ? "border-b-2 border-blue-600 text-blue-600" : "text-gray-400 hover:text-gray-600"}`}>
            {t === "detail" ? "상세" : t === "comments" ? `댓글 ${comments.length}` : "히스토리"}
          </button>
        ))}
      </div>

      {/* 탭 콘텐츠 */}
      <div className="flex-1 overflow-y-auto">
        {tab === "detail" && (
          <div className="p-5 space-y-4 text-sm">
            {issue.screenshotUrl && (
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase mb-1.5">스크린샷</p>
                <a href={issue.screenshotUrl} target="_blank" rel="noopener noreferrer">
                  <img src={issue.screenshotUrl} alt="스크린샷"
                    className="w-full rounded-lg border border-gray-200 hover:opacity-90 transition-opacity" />
                </a>
              </div>
            )}
            {issue.description && (
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase mb-1.5">설명</p>
                <p className="text-xs text-gray-600 leading-relaxed whitespace-pre-wrap">{issue.description}</p>
              </div>
            )}
            {issue.stepToReproduce && (
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase mb-1.5">재현 단계</p>
                <pre className="text-xs bg-gray-50 border border-gray-200 rounded-lg p-3 whitespace-pre-wrap leading-relaxed">{issue.stepToReproduce}</pre>
              </div>
            )}
            {issue.expectedResult && (
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase mb-1.5">기대 결과</p>
                <p className="text-xs bg-green-50 border border-green-200 rounded-lg p-3 text-green-800 leading-relaxed">{issue.expectedResult}</p>
              </div>
            )}
            {issue.actualResult && (
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase mb-1.5">실제 결과</p>
                <p className="text-xs bg-red-50 border border-red-200 rounded-lg p-3 text-red-800 leading-relaxed">{issue.actualResult}</p>
              </div>
            )}
            {issue.targetUrl && (
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase mb-1.5">페이지 URL</p>
                <a href={issue.targetUrl} target="_blank" rel="noopener noreferrer"
                  className="text-xs text-blue-600 hover:underline break-all">{issue.targetUrl}</a>
              </div>
            )}
          </div>
        )}

        {tab === "comments" && (
          <div className="flex flex-col h-full">
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {comments.length === 0 ? (
                <p className="text-xs text-gray-400 text-center py-8">첫 댓글을 남겨보세요</p>
              ) : comments.map(c => (
                <div key={c.id} className="bg-gray-50 rounded-xl p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-bold text-gray-700">{c.authorName}</span>
                    <span className="text-xs text-gray-400 ml-auto">{relTime(c.createdAt)}</span>
                  </div>
                  <p className="text-xs text-gray-600 leading-relaxed">{c.content}</p>
                </div>
              ))}
            </div>
            <form onSubmit={handleComment} className="border-t p-3 space-y-2 shrink-0">
              <input value={author} onChange={e => setAuthor(e.target.value)}
                placeholder="이름 (선택)"
                className="w-full text-xs border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:border-blue-400" />
              <textarea ref={commentRef} value={comment} onChange={e => setComment(e.target.value)}
                placeholder="댓글 입력..." rows={2}
                className="w-full text-xs border border-gray-200 rounded-lg px-3 py-1.5 resize-none focus:outline-none focus:border-blue-400" />
              <button type="submit" disabled={posting || !comment.trim()}
                className="w-full text-xs font-semibold bg-blue-600 text-white py-1.5 rounded-lg hover:bg-blue-700 disabled:opacity-40 transition-colors">
                {posting ? "등록 중..." : "댓글 등록"}
              </button>
            </form>
          </div>
        )}

        {tab === "history" && (
          <div className="p-4">
            {history.length === 0 ? (
              <p className="text-xs text-gray-400 text-center py-8">변경 이력이 없습니다</p>
            ) : history.map(h => (
              <div key={h.id} className="flex items-center gap-2 py-2 border-b border-gray-100 last:border-0">
                <span className="text-xs text-gray-500">{h.field}</span>
                <span className="text-xs text-gray-400">{h.oldValue} → <strong>{h.newValue}</strong></span>
                <span className="text-xs text-gray-400 ml-auto">{relTime(h.createdAt)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 하단 삭제 */}
      <div className="border-t p-3 shrink-0">
        <button onClick={onDelete}
          className="w-full text-xs font-semibold text-red-500 border border-red-200 py-2 rounded-lg hover:bg-red-50 transition-colors">
          이슈 삭제
        </button>
      </div>
    </div>
  );
}

// ─── BoardModal ───────────────────────────────────────────────
function BoardModal({ onClose, onCreated }: { onClose: () => void; onCreated: (b: Board) => void }) {
  const [name, setName] = useState(""); const [desc, setDesc] = useState(""); const [url, setUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); if (!name.trim()) return; setSaving(true);
    const d = await api.createBoard({ name, description: desc || undefined, targetUrl: url || undefined });
    if (d.board) onCreated(d.board); setSaving(false);
  };
  return (
    <Modal title="새 QA 보드 만들기" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="보드 이름 *">
          <input value={name} onChange={e => setName(e.target.value)} required autoFocus
            placeholder="예: 회원가입 플로우 QA"
            className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400" />
        </Field>
        <Field label="설명">
          <input value={desc} onChange={e => setDesc(e.target.value)} placeholder="이 보드에 대한 간단한 설명"
            className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400" />
        </Field>
        <Field label="대상 URL">
          <input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://example.com"
            className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400" />
        </Field>
        <ModalActions onClose={onClose} saving={saving} label="보드 만들기" />
      </form>
    </Modal>
  );
}

// ─── IssueModal ───────────────────────────────────────────────
function IssueModal({ boardId, onClose, onCreated }: { boardId: string; onClose: () => void; onCreated: () => void }) {
  const [f, setF] = useState({ title: "", description: "", type: "bug", severity: "minor", step: "", expected: "", actual: "", url: "" });
  const [saving, setSaving] = useState(false);
  const u = (k: string, v: string) => setF(p => ({ ...p, [k]: v }));
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); if (!f.title.trim()) return; setSaving(true);
    await api.createIssue(boardId, { title: f.title, description: f.description || undefined, type: f.type, severity: f.severity, stepToReproduce: f.step || undefined, expectedResult: f.expected || undefined, actualResult: f.actual || undefined, targetUrl: f.url || undefined });
    onCreated(); setSaving(false);
  };
  return (
    <Modal title="새 이슈 추가" onClose={onClose} wide>
      <form onSubmit={handleSubmit} className="space-y-3">
        <Field label="제목 *">
          <input value={f.title} onChange={e => u("title", e.target.value)} required autoFocus placeholder="이슈 제목"
            className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="유형">
            <select value={f.type} onChange={e => u("type", e.target.value)}
              className="w-full border rounded-lg px-2 py-2 text-sm focus:outline-none">
              {Object.entries(TYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Field>
          <Field label="심각도">
            <select value={f.severity} onChange={e => u("severity", e.target.value)}
              className="w-full border rounded-lg px-2 py-2 text-sm focus:outline-none">
              {(["critical", "major", "minor", "trivial"] as Severity[]).map(s => (
                <option key={s} value={s}>{SEV[s].label}</option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="설명">
          <textarea value={f.description} onChange={e => u("description", e.target.value)} rows={2} placeholder="이슈 상세 설명"
            className="w-full border rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:border-blue-400" />
        </Field>
        <Field label="재현 단계">
          <textarea value={f.step} onChange={e => u("step", e.target.value)} rows={3}
            placeholder={"1. 로그인 페이지 접속\n2. 이메일 입력\n3. 로그인 버튼 클릭"}
            className="w-full border rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:border-blue-400 font-mono" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="기대 결과">
            <textarea value={f.expected} onChange={e => u("expected", e.target.value)} rows={2}
              className="w-full border rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:border-blue-400" />
          </Field>
          <Field label="실제 결과">
            <textarea value={f.actual} onChange={e => u("actual", e.target.value)} rows={2}
              className="w-full border rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:border-blue-400" />
          </Field>
        </div>
        <Field label="관련 URL">
          <input value={f.url} onChange={e => u("url", e.target.value)} placeholder="https://example.com/page"
            className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400" />
        </Field>
        <ModalActions onClose={onClose} saving={saving} label="이슈 추가" />
      </form>
    </Modal>
  );
}

// ─── ImportModal ──────────────────────────────────────────────
function ImportModal({ boardId, onClose, onImported }: { boardId: string; onClose: () => void; onImported: () => void }) {
  const [reports, setReports] = useState<SavedReport[]>([]);
  const [selectedReport, setSelectedReport] = useState<SavedReport | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [importing, setImporting] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.reports().then(d => { setReports(d.reports ?? []); setLoading(false); });
  }, []);

  const toggleAll = () =>
    setSelected(selected.size === selectedReport?.findings.length
      ? new Set() : new Set(selectedReport?.findings.map((_, i) => i)));

  const handleImport = async () => {
    if (!selectedReport || selected.size === 0) return;
    setImporting(true);
    const findings = Array.from(selected).map(i => selectedReport.findings[i]);
    await api.importIssues(boardId, findings, selectedReport.targetUrl);
    onImported();
  };

  return (
    <Modal title="AI 테스트 결과에서 가져오기" onClose={onClose} wide>
      {loading ? (
        <p className="text-sm text-gray-400 text-center py-8">리포트 불러오는 중...</p>
      ) : reports.length === 0 ? (
        <div className="text-center py-8">
          <p className="text-gray-400 text-sm">저장된 리포트가 없습니다.</p>
          <p className="text-xs text-gray-400 mt-1">Auto Agent 실행 후 리포트를 저장하면 여기서 가져올 수 있습니다.</p>
        </div>
      ) : !selectedReport ? (
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {reports.map(r => (
            <button key={r.id} onClick={() => { setSelectedReport(r); setSelected(new Set(r.findings.map((_, i) => i))); }}
              className="w-full text-left p-3 border border-gray-200 rounded-xl hover:border-blue-300 hover:bg-blue-50 transition-all">
              <div className="flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-800 truncate">{r.name}</p>
                  <p className="text-xs text-gray-400 truncate">{r.targetUrl}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-xs font-bold text-red-600">{r.findingCount}개 발견</p>
                  <p className="text-xs text-gray-400">{new Date(r.savedAt).toLocaleDateString("ko-KR")}</p>
                </div>
              </div>
            </button>
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <button onClick={() => setSelectedReport(null)} className="text-xs text-blue-600 hover:underline">← 뒤로</button>
            <span className="text-sm font-semibold text-gray-700 truncate">{selectedReport.name}</span>
            <button onClick={toggleAll} className="ml-auto text-xs text-blue-600 hover:underline">
              {selected.size === selectedReport.findings.length ? "전체 해제" : "전체 선택"}
            </button>
          </div>
          <div className="max-h-72 overflow-y-auto space-y-2">
            {selectedReport.findings.map((f, i) => {
              const sev = SEV[(SEV_MAP[f.severity] as Severity) ?? "minor"];
              return (
                <label key={i} className={`flex items-start gap-3 p-3 border rounded-xl cursor-pointer transition-all ${selected.has(i) ? "border-blue-300 bg-blue-50" : "border-gray-200 hover:border-gray-300"}`}>
                  <input type="checkbox" checked={selected.has(i)}
                    onChange={() => setSelected(p => { const n = new Set(p); n.has(i) ? n.delete(i) : n.add(i); return n; })}
                    className="mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className={`text-xs font-semibold px-1.5 py-0.5 rounded-full ${sev.bg} ${sev.text}`}>{sev.label}</span>
                    </div>
                    <p className="text-sm font-medium text-gray-800">{f.title}</p>
                    {f.description && <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{f.description}</p>}
                  </div>
                </label>
              );
            })}
          </div>
          <div className="flex items-center gap-3 pt-1">
            <span className="text-xs text-gray-500">{selected.size}개 선택됨</span>
            <button onClick={onClose} className="flex-1 border border-gray-200 text-gray-600 py-2 rounded-lg text-sm hover:bg-gray-50">취소</button>
            <button onClick={handleImport} disabled={importing || selected.size === 0}
              className="flex-1 bg-blue-600 text-white py-2 rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-40">
              {importing ? "가져오는 중..." : `${selected.size}개 이슈로 추가`}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

const SEV_MAP: Record<string, string> = { critical: "critical", high: "major", medium: "minor", low: "trivial" };

// ─── ShareModal ───────────────────────────────────────────────
function ShareModal({ board, copied, onCopy, onCreated, onClose }: {
  board: Board; copied: boolean;
  onCopy: (token: string) => void;
  onCreated: () => void;
  onClose: () => void;
}) {
  const [label, setLabel] = useState("");
  const [creating, setCreating] = useState(false);
  const links = board.shareLinks;

  const handleCreate = async () => {
    setCreating(true);
    const d = await api.createShare(board.id, label || undefined);
    if (d.link) { onCreated(); setLabel(""); }
    setCreating(false);
  };

  return (
    <Modal title="공유 링크 관리" onClose={onClose}>
      <div className="space-y-4">
        {/* 기존 링크 */}
        {links.length > 0 && (
          <div className="space-y-2">
            {links.map(link => (
              <div key={link.id} className="flex items-center gap-2 p-3 bg-gray-50 border border-gray-200 rounded-xl">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-gray-700">{link.label ?? "공유 링크"}</p>
                  <p className="text-xs text-gray-400 truncate">{typeof window !== "undefined" ? window.location.origin : ""}/share/{link.publicToken}</p>
                  <p className="text-xs text-gray-400 mt-0.5">👁 {link.viewCount}회 조회</p>
                </div>
                <button onClick={() => onCopy(link.publicToken)}
                  className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition-all ${copied ? "bg-green-500 text-white" : "bg-blue-600 text-white hover:bg-blue-700"}`}>
                  {copied ? "✅ 복사됨" : "복사"}
                </button>
              </div>
            ))}
          </div>
        )}

        {/* 새 링크 생성 */}
        <div className="border-t pt-4">
          <p className="text-xs font-semibold text-gray-500 uppercase mb-2">새 공유 링크</p>
          <div className="flex gap-2">
            <input value={label} onChange={e => setLabel(e.target.value)} placeholder="링크 라벨 (선택)"
              className="flex-1 text-sm border rounded-lg px-3 py-2 focus:outline-none focus:border-blue-400" />
            <button onClick={handleCreate} disabled={creating}
              className="text-sm font-semibold bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-40">
              {creating ? "..." : "생성"}
            </button>
          </div>
          <p className="text-xs text-gray-400 mt-2">공유 링크를 통해 누구나 로그인 없이 이 보드를 볼 수 있습니다.</p>
        </div>
      </div>
    </Modal>
  );
}

// ─── 공통 컴포넌트 ─────────────────────────────────────────────
function Modal({ title, onClose, children, wide }: {
  title: string; onClose: () => void; children: React.ReactNode; wide?: boolean;
}) {
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className={`bg-white rounded-2xl shadow-2xl w-full ${wide ? "max-w-xl" : "max-w-md"} max-h-[90vh] flex flex-col`}
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b shrink-0">
          <h2 className="font-bold text-gray-800">{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
        </div>
        <div className="overflow-y-auto px-6 py-4">{children}</div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{label}</label>
      {children}
    </div>
  );
}

function ModalActions({ onClose, saving, label }: { onClose: () => void; saving: boolean; label: string }) {
  return (
    <div className="flex gap-2 pt-2">
      <button type="button" onClick={onClose}
        className="flex-1 border border-gray-200 text-gray-600 py-2 rounded-xl text-sm hover:bg-gray-50">
        취소
      </button>
      <button type="submit" disabled={saving}
        className="flex-1 bg-blue-600 text-white py-2 rounded-xl text-sm font-semibold hover:bg-blue-700 disabled:opacity-40">
        {saving ? "처리 중..." : label}
      </button>
    </div>
  );
}
