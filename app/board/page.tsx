"use client";

import { useEffect, useState, useCallback } from "react";

interface Board {
  id: string;
  name: string;
  description?: string;
  targetUrl?: string;
  createdAt: string;
  _count: { issues: number };
  shareLinks: ShareLink[];
}

interface ShareLink {
  id: string;
  publicToken: string;
  label?: string;
  expiresAt?: string;
  viewCount: number;
  createdAt: string;
}

interface Issue {
  id: string;
  title: string;
  type: string;
  severity: string;
  status: string;
  description?: string;
  stepToReproduce?: string;
  expectedResult?: string;
  actualResult?: string;
  screenshotUrl?: string;
  targetUrl?: string;
  createdAt: string;
  _count: { comments: number };
}

const SEV_COLORS: Record<string, string> = {
  critical: "bg-red-100 text-red-700",
  major:    "bg-orange-100 text-orange-700",
  minor:    "bg-yellow-100 text-yellow-700",
  trivial:  "bg-gray-100 text-gray-500",
};

const STATUS_COLORS: Record<string, string> = {
  open:        "bg-red-50 text-red-600 border-red-200",
  in_progress: "bg-yellow-50 text-yellow-600 border-yellow-200",
  resolved:    "bg-green-50 text-green-600 border-green-200",
  wont_fix:    "bg-gray-50 text-gray-500 border-gray-200",
};

const STATUS_LABELS: Record<string, string> = {
  open: "Open", in_progress: "In Progress", resolved: "Resolved", wont_fix: "Won't Fix",
};

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text).catch(() => {});
}

export default function BoardPage() {
  const [boards, setBoards] = useState<Board[]>([]);
  const [selectedBoard, setSelectedBoard] = useState<Board | null>(null);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateBoard, setShowCreateBoard] = useState(false);
  const [showCreateIssue, setShowCreateIssue] = useState(false);
  const [selectedIssue, setSelectedIssue] = useState<Issue | null>(null);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);

  // 보드 목록 로드
  const loadBoards = useCallback(() => {
    fetch("/api/boards")
      .then(r => r.json())
      .then(d => setBoards(d.boards ?? []))
      .finally(() => setLoading(false));
  }, []);

  // 이슈 목록 로드
  const loadIssues = useCallback((boardId: string) => {
    fetch(`/api/boards/${boardId}/issues`)
      .then(r => r.json())
      .then(d => setIssues(d.issues ?? []));
  }, []);

  useEffect(() => { loadBoards(); }, [loadBoards]);
  useEffect(() => {
    if (selectedBoard) loadIssues(selectedBoard.id);
    else setIssues([]);
  }, [selectedBoard, loadIssues]);

  const handleCopyLink = (token: string) => {
    const url = `${window.location.origin}/share/${token}`;
    copyToClipboard(url);
    setCopiedToken(token);
    setTimeout(() => setCopiedToken(null), 2000);
  };

  const handleCreateShareLink = async (boardId: string) => {
    const label = prompt("공유 링크 라벨 (선택사항):");
    const res = await fetch(`/api/boards/${boardId}/share`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: label || undefined }),
    });
    const data = await res.json();
    if (data.url) {
      copyToClipboard(data.url);
      alert(`공유 링크가 생성되고 클립보드에 복사되었습니다!\n${data.url}`);
      loadBoards();
    }
  };

  const handleStatusChange = async (issue: Issue, newStatus: string) => {
    await fetch(`/api/boards/${selectedBoard!.id}/issues/${issue.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    });
    loadIssues(selectedBoard!.id);
  };

  const handleDeleteIssue = async (issue: Issue) => {
    if (!confirm(`"${issue.title}" 이슈를 삭제하시겠습니까?`)) return;
    await fetch(`/api/boards/${selectedBoard!.id}/issues/${issue.id}`, { method: "DELETE" });
    setSelectedIssue(null);
    loadIssues(selectedBoard!.id);
  };

  return (
    <div className="flex h-screen bg-gray-50">
      {/* 사이드바 — 보드 목록 */}
      <aside className="w-64 bg-white border-r flex flex-col">
        <div className="p-4 border-b">
          <div className="flex items-center justify-between mb-1">
            <h1 className="text-base font-black text-gray-800">QA Board</h1>
            <a href="/dashboard" className="text-xs text-gray-400 hover:text-gray-600">← 대시보드</a>
          </div>
          <p className="text-xs text-gray-400">이슈 트래킹 & 공유</p>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-1">
          {loading ? (
            <p className="text-xs text-gray-400 p-2">로딩 중...</p>
          ) : boards.length === 0 ? (
            <p className="text-xs text-gray-400 p-2">보드가 없습니다.</p>
          ) : (
            boards.map(b => (
              <button
                key={b.id}
                onClick={() => setSelectedBoard(b)}
                className={`w-full text-left px-3 py-2 rounded-lg transition-all ${
                  selectedBoard?.id === b.id
                    ? "bg-blue-50 border border-blue-200"
                    : "hover:bg-gray-50 border border-transparent"
                }`}
              >
                <p className="text-sm font-semibold text-gray-800 truncate">{b.name}</p>
                <p className="text-xs text-gray-400">{b._count.issues}개 이슈</p>
              </button>
            ))
          )}
        </div>

        <div className="p-3 border-t">
          <button
            onClick={() => setShowCreateBoard(true)}
            className="w-full text-sm font-semibold bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700 transition-colors"
          >
            + 새 보드
          </button>
        </div>
      </aside>

      {/* 메인 영역 */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {!selectedBoard ? (
          <div className="flex-1 flex items-center justify-center text-gray-400">
            <div className="text-center">
              <p className="text-5xl mb-4">📋</p>
              <p className="text-lg font-semibold text-gray-600">보드를 선택하세요</p>
              <p className="text-sm mt-1">또는 새 보드를 만들어 이슈를 관리하세요.</p>
            </div>
          </div>
        ) : (
          <>
            {/* 보드 헤더 */}
            <div className="bg-white border-b px-6 py-3 flex items-center gap-3">
              <div className="flex-1">
                <h2 className="font-bold text-gray-800">{selectedBoard.name}</h2>
                {selectedBoard.description && (
                  <p className="text-xs text-gray-400">{selectedBoard.description}</p>
                )}
              </div>
              {/* 통계 */}
              <div className="hidden sm:flex gap-4 text-xs text-center text-gray-500">
                {["open", "in_progress", "resolved"].map(s => (
                  <div key={s}>
                    <p className="text-lg font-black text-gray-800">
                      {issues.filter(i => i.status === s).length}
                    </p>
                    <p>{STATUS_LABELS[s]}</p>
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => handleCreateShareLink(selectedBoard.id)}
                  className="text-xs font-semibold bg-gray-100 text-gray-700 px-3 py-1.5 rounded-lg hover:bg-gray-200 transition-colors"
                >
                  🔗 공유 링크
                </button>
                <button
                  onClick={() => setShowCreateIssue(true)}
                  className="text-xs font-semibold bg-blue-600 text-white px-3 py-1.5 rounded-lg hover:bg-blue-700 transition-colors"
                >
                  + 이슈 추가
                </button>
              </div>
            </div>

            {/* 공유 링크 목록 */}
            {selectedBoard.shareLinks.length > 0 && (
              <div className="bg-blue-50 border-b border-blue-100 px-6 py-2 flex items-center gap-3 flex-wrap">
                <span className="text-xs font-semibold text-blue-700">공유 링크:</span>
                {selectedBoard.shareLinks.map(link => (
                  <button
                    key={link.id}
                    onClick={() => handleCopyLink(link.publicToken)}
                    className="text-xs bg-white border border-blue-200 text-blue-600 px-2 py-1 rounded hover:bg-blue-100 transition-colors"
                  >
                    {copiedToken === link.publicToken ? "✅ 복사됨" : `🔗 ${link.label ?? "공유 링크"} (👁 ${link.viewCount})`}
                  </button>
                ))}
              </div>
            )}

            {/* Kanban */}
            <div className="flex-1 overflow-x-auto p-4">
              <div className="flex gap-4 h-full min-w-max">
                {(["open", "in_progress", "resolved", "wont_fix"] as const).map(status => {
                  const col = issues.filter(i => i.status === status);
                  return (
                    <div key={status} className="w-72 flex-shrink-0 flex flex-col gap-2">
                      <div className="flex items-center gap-2">
                        <h3 className="font-bold text-sm text-gray-700">{STATUS_LABELS[status]}</h3>
                        <span className="ml-auto bg-gray-200 text-gray-600 text-xs font-bold px-2 py-0.5 rounded-full">
                          {col.length}
                        </span>
                      </div>
                      <div className="flex-1 overflow-y-auto space-y-2 pr-1">
                        {col.length === 0 && (
                          <div className="border-2 border-dashed border-gray-200 rounded-lg p-8 text-center text-xs text-gray-400">
                            비어 있음
                          </div>
                        )}
                        {col.map(issue => (
                          <div
                            key={issue.id}
                            className="bg-white border border-gray-200 rounded-lg p-3 cursor-pointer hover:shadow-sm hover:border-blue-300 transition-all"
                            onClick={() => setSelectedIssue(issue)}
                          >
                            <div className="flex items-center gap-2 mb-1.5">
                              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${SEV_COLORS[issue.severity] ?? ""}`}>
                                {issue.severity}
                              </span>
                              <span className="text-xs text-gray-400">{issue.type}</span>
                            </div>
                            <p className="text-sm font-medium text-gray-800 line-clamp-2">{issue.title}</p>
                            {issue._count.comments > 0 && (
                              <p className="text-xs text-gray-400 mt-1">💬 {issue._count.comments}</p>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </main>

      {/* 이슈 상세 사이드 패널 */}
      {selectedIssue && (
        <div className="w-80 bg-white border-l flex flex-col shadow-lg">
          <div className="p-4 border-b flex items-center gap-2">
            <h3 className="flex-1 font-bold text-sm text-gray-800 truncate">{selectedIssue.title}</h3>
            <button onClick={() => setSelectedIssue(null)} className="text-gray-400 hover:text-gray-600">✕</button>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-3 text-sm">
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase">상태</label>
              <select
                value={selectedIssue.status}
                onChange={e => handleStatusChange(selectedIssue, e.target.value)}
                className="mt-1 w-full border rounded-lg px-2 py-1.5 text-sm"
              >
                {Object.entries(STATUS_LABELS).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </div>
            <div className="flex gap-2">
              <span className={`text-xs font-semibold px-2 py-1 rounded-full ${SEV_COLORS[selectedIssue.severity]}`}>
                {selectedIssue.severity}
              </span>
              <span className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded-full">{selectedIssue.type}</span>
            </div>
            {selectedIssue.description && (
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase mb-1">설명</p>
                <p className="text-gray-600 text-xs leading-relaxed">{selectedIssue.description}</p>
              </div>
            )}
            {selectedIssue.stepToReproduce && (
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase mb-1">재현 단계</p>
                <pre className="text-xs bg-gray-50 border rounded p-2 whitespace-pre-wrap">{selectedIssue.stepToReproduce}</pre>
              </div>
            )}
            {selectedIssue.expectedResult && (
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase mb-1">기대 결과</p>
                <p className="text-xs bg-green-50 border border-green-200 rounded p-2">{selectedIssue.expectedResult}</p>
              </div>
            )}
            {selectedIssue.actualResult && (
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase mb-1">실제 결과</p>
                <p className="text-xs bg-red-50 border border-red-200 rounded p-2">{selectedIssue.actualResult}</p>
              </div>
            )}
            {selectedIssue.screenshotUrl && (
              <img src={selectedIssue.screenshotUrl} alt="스크린샷" className="w-full rounded border" />
            )}
          </div>
          <div className="p-4 border-t">
            <button
              onClick={() => handleDeleteIssue(selectedIssue)}
              className="w-full text-xs font-semibold text-red-500 border border-red-200 py-1.5 rounded-lg hover:bg-red-50 transition-colors"
            >
              이슈 삭제
            </button>
          </div>
        </div>
      )}

      {/* 보드 생성 모달 */}
      {showCreateBoard && (
        <CreateBoardModal
          onClose={() => setShowCreateBoard(false)}
          onCreated={(board) => {
            loadBoards();
            setShowCreateBoard(false);
            setSelectedBoard(board);
          }}
        />
      )}

      {/* 이슈 생성 모달 */}
      {showCreateIssue && selectedBoard && (
        <CreateIssueModal
          boardId={selectedBoard.id}
          onClose={() => setShowCreateIssue(false)}
          onCreated={() => {
            loadIssues(selectedBoard.id);
            setShowCreateIssue(false);
          }}
        />
      )}
    </div>
  );
}

function CreateBoardModal({ onClose, onCreated }: {
  onClose: () => void;
  onCreated: (board: Board) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [targetUrl, setTargetUrl] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    const res = await fetch("/api/boards", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, description: description || undefined, targetUrl: targetUrl || undefined }),
    });
    const data = await res.json();
    if (data.board) onCreated(data.board);
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <form onSubmit={handleSubmit} className="bg-white rounded-xl w-full max-w-md shadow-xl p-6 space-y-4">
        <h2 className="font-bold text-gray-800">새 QA 보드 만들기</h2>
        <div>
          <label className="text-xs font-semibold text-gray-500 uppercase">보드 이름 *</label>
          <input
            value={name} onChange={e => setName(e.target.value)}
            placeholder="예: 회원가입 플로우 QA"
            className="mt-1 w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400"
            required
          />
        </div>
        <div>
          <label className="text-xs font-semibold text-gray-500 uppercase">설명</label>
          <input
            value={description} onChange={e => setDescription(e.target.value)}
            placeholder="이 보드에 대한 설명"
            className="mt-1 w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400"
          />
        </div>
        <div>
          <label className="text-xs font-semibold text-gray-500 uppercase">대상 URL</label>
          <input
            value={targetUrl} onChange={e => setTargetUrl(e.target.value)}
            placeholder="https://example.com"
            className="mt-1 w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400"
          />
        </div>
        <div className="flex gap-2 pt-2">
          <button type="button" onClick={onClose}
            className="flex-1 border border-gray-200 text-gray-600 py-2 rounded-lg text-sm hover:bg-gray-50">
            취소
          </button>
          <button type="submit" disabled={saving}
            className="flex-1 bg-blue-600 text-white py-2 rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50">
            {saving ? "생성 중..." : "보드 만들기"}
          </button>
        </div>
      </form>
    </div>
  );
}

function CreateIssueModal({ boardId, onClose, onCreated }: {
  boardId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [form, setForm] = useState({
    title: "", description: "", type: "bug", severity: "minor",
    stepToReproduce: "", expectedResult: "", actualResult: "", targetUrl: "",
  });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) return;
    setSaving(true);
    await fetch(`/api/boards/${boardId}/issues`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        stepToReproduce: form.stepToReproduce || undefined,
        expectedResult: form.expectedResult || undefined,
        actualResult: form.actualResult || undefined,
        targetUrl: form.targetUrl || undefined,
      }),
    });
    setSaving(false);
    onCreated();
  };

  const update = (k: string, v: string) => setForm(p => ({ ...p, [k]: v }));

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4 overflow-y-auto">
      <form onSubmit={handleSubmit} className="bg-white rounded-xl w-full max-w-lg shadow-xl p-6 space-y-3 my-4">
        <h2 className="font-bold text-gray-800">새 이슈 추가</h2>
        <div>
          <label className="text-xs font-semibold text-gray-500 uppercase">제목 *</label>
          <input
            value={form.title} onChange={e => update("title", e.target.value)}
            placeholder="이슈 제목을 입력하세요"
            className="mt-1 w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400"
            required
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase">유형</label>
            <select value={form.type} onChange={e => update("type", e.target.value)}
              className="mt-1 w-full border rounded-lg px-2 py-2 text-sm">
              {["bug", "design", "content", "accessibility", "spec"].map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase">심각도</label>
            <select value={form.severity} onChange={e => update("severity", e.target.value)}
              className="mt-1 w-full border rounded-lg px-2 py-2 text-sm">
              {["critical", "major", "minor", "trivial"].map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label className="text-xs font-semibold text-gray-500 uppercase">설명</label>
          <textarea
            value={form.description} onChange={e => update("description", e.target.value)}
            rows={2} placeholder="이슈 상세 설명"
            className="mt-1 w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400 resize-none"
          />
        </div>
        <div>
          <label className="text-xs font-semibold text-gray-500 uppercase">재현 단계</label>
          <textarea
            value={form.stepToReproduce} onChange={e => update("stepToReproduce", e.target.value)}
            rows={2} placeholder="1. 로그인 페이지 접속&#10;2. 이메일 입력&#10;3. ..."
            className="mt-1 w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400 resize-none"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase">기대 결과</label>
            <textarea
              value={form.expectedResult} onChange={e => update("expectedResult", e.target.value)}
              rows={2} placeholder="정상적으로 로그인됨"
              className="mt-1 w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400 resize-none"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase">실제 결과</label>
            <textarea
              value={form.actualResult} onChange={e => update("actualResult", e.target.value)}
              rows={2} placeholder="에러 메시지가 표시됨"
              className="mt-1 w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400 resize-none"
            />
          </div>
        </div>
        <div>
          <label className="text-xs font-semibold text-gray-500 uppercase">관련 URL</label>
          <input
            value={form.targetUrl} onChange={e => update("targetUrl", e.target.value)}
            placeholder="https://example.com/page"
            className="mt-1 w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400"
          />
        </div>
        <div className="flex gap-2 pt-2">
          <button type="button" onClick={onClose}
            className="flex-1 border border-gray-200 text-gray-600 py-2 rounded-lg text-sm hover:bg-gray-50">
            취소
          </button>
          <button type="submit" disabled={saving}
            className="flex-1 bg-blue-600 text-white py-2 rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50">
            {saving ? "추가 중..." : "이슈 추가"}
          </button>
        </div>
      </form>
    </div>
  );
}
