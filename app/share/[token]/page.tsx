"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";

type Severity = "critical" | "major" | "minor" | "trivial";
type Status   = "todo" | "in_progress" | "in_review" | "done" | "wont_fix";

interface Issue {
  id: string;
  title: string;
  description?: string;
  type: string;
  severity: Severity;
  status: Status;
  screenshotUrl?: string;
  targetUrl?: string;
  stepToReproduce?: string;
  expectedResult?: string;
  actualResult?: string;
  tags: string[];
  commentCount: number;
  createdAt: string;
  updatedAt: string;
}

interface BoardData {
  token: string;
  label?: string;
  viewCount: number;
  board: { id: string; name: string; description?: string; targetUrl?: string };
  stats: { total: number; resolved: number; criticalOpen: number; resolveRate: number };
  issues: Issue[];
}

const SEV_CONFIG: Record<Severity, { label: string; color: string; dot: string }> = {
  critical: { label: "Critical", color: "bg-red-100 text-red-700",    dot: "bg-red-500"    },
  major:    { label: "Major",    color: "bg-orange-100 text-orange-700", dot: "bg-orange-500" },
  minor:    { label: "Minor",    color: "bg-yellow-100 text-yellow-700", dot: "bg-yellow-500" },
  trivial:  { label: "Trivial",  color: "bg-gray-100 text-gray-600",   dot: "bg-gray-400"   },
};

const STATUS_COLS: { id: Status; label: string; color: string }[] = [
  { id: "todo",        label: "할 일",       color: "border-slate-400"  },
  { id: "in_progress", label: "진행 중",     color: "border-blue-400"   },
  { id: "in_review",   label: "검토 중",     color: "border-violet-400" },
  { id: "done",        label: "완료",         color: "border-green-400"  },
  { id: "wont_fix",    label: "해결 안 함",  color: "border-gray-400"   },
];

function relativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "방금 전";
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  return `${Math.floor(hr / 24)}일 전`;
}

function IssueCard({ issue, onClick }: { issue: Issue; onClick: () => void }) {
  const sev = SEV_CONFIG[issue.severity];
  return (
    <button
      onClick={onClick}
      className="w-full text-left bg-white border border-gray-200 rounded-lg p-3 hover:border-blue-300 hover:shadow-sm transition-all"
    >
      <div className="flex items-start gap-2 mb-1.5">
        <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full ${sev.color}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${sev.dot}`} />
          {sev.label}
        </span>
        <span className="text-xs text-gray-400 ml-auto">{relativeTime(issue.createdAt)}</span>
      </div>
      <p className="text-sm font-medium text-gray-800 leading-snug line-clamp-2">{issue.title}</p>
      {issue.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {issue.tags.map(t => (
            <span key={t} className="text-xs bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded">{t}</span>
          ))}
        </div>
      )}
      {issue.commentCount > 0 && (
        <p className="text-xs text-gray-400 mt-1.5">💬 {issue.commentCount}개 댓글</p>
      )}
    </button>
  );
}

function IssueDetail({ issue, onClose }: { issue: Issue; onClose: () => void }) {
  const sev = SEV_CONFIG[issue.severity];
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex justify-end" onClick={onClose}>
      <div
        className="w-full max-w-lg bg-white h-full overflow-y-auto shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-white border-b px-5 py-3 flex items-center gap-3">
          <span className={`text-xs font-bold px-2 py-1 rounded-full ${sev.color}`}>{sev.label}</span>
          <h2 className="flex-1 font-semibold text-gray-800 text-sm">{issue.title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
        </div>
        <div className="p-5 space-y-4 text-sm text-gray-700">
          <div className="flex gap-3">
            <span className="bg-gray-100 text-gray-600 px-2 py-1 rounded text-xs">{issue.type}</span>
            <span className="bg-gray-100 text-gray-600 px-2 py-1 rounded text-xs capitalize">{issue.status.replace("_", " ")}</span>
          </div>
          {issue.description && <p className="text-gray-600 leading-relaxed">{issue.description}</p>}
          {issue.screenshotUrl && (
            <img src={issue.screenshotUrl} alt="스크린샷" className="w-full rounded-lg border border-gray-200" />
          )}
          {issue.stepToReproduce && (
            <div>
              <p className="font-semibold text-gray-800 mb-1">재현 단계</p>
              <pre className="text-xs bg-gray-50 border rounded p-3 whitespace-pre-wrap">{issue.stepToReproduce}</pre>
            </div>
          )}
          {issue.expectedResult && (
            <div>
              <p className="font-semibold text-gray-800 mb-1">기대 결과</p>
              <p className="text-gray-600 bg-green-50 border border-green-200 rounded p-2 text-xs">{issue.expectedResult}</p>
            </div>
          )}
          {issue.actualResult && (
            <div>
              <p className="font-semibold text-gray-800 mb-1">실제 결과</p>
              <p className="text-gray-600 bg-red-50 border border-red-200 rounded p-2 text-xs">{issue.actualResult}</p>
            </div>
          )}
          {issue.targetUrl && (
            <div>
              <p className="font-semibold text-gray-800 mb-1">관련 URL</p>
              <a href={issue.targetUrl} target="_blank" rel="noopener noreferrer"
                className="text-blue-600 underline text-xs break-all">{issue.targetUrl}</a>
            </div>
          )}
          <p className="text-xs text-gray-400">생성: {new Date(issue.createdAt).toLocaleString("ko-KR")}</p>
        </div>
      </div>
    </div>
  );
}

export default function SharePage() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<BoardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Issue | null>(null);
  const [filter, setFilter] = useState<Severity | "all">("all");
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());

  const load = useCallback(() => {
    fetch(`/api/share/${token}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) setError(d.error);
        else { setData(d); setLastUpdated(new Date()); }
      })
      .catch(() => setError("데이터를 불러오지 못했습니다."));
  }, [token]);

  useEffect(() => {
    load();
    // 30초마다 폴링으로 실시간 업데이트 (Supabase Realtime 없이)
    const timer = setInterval(load, 30_000);
    return () => clearInterval(timer);
  }, [load]);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <p className="text-4xl mb-4">🔒</p>
          <h1 className="text-xl font-bold text-gray-800 mb-2">접근할 수 없습니다</h1>
          <p className="text-gray-500">{error}</p>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center text-gray-400">
          <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p>보드를 불러오는 중...</p>
        </div>
      </div>
    );
  }

  const filtered = data.issues.filter(i => filter === "all" || i.severity === filter);
  const byStatus = (s: Status) => filtered.filter(i => i.status === s);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 헤더 */}
      <header className="bg-white border-b shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-lg font-black text-blue-600">QA</span>
            <span className="text-lg font-black text-gray-800">Board</span>
          </div>
          <div className="h-5 w-px bg-gray-200" />
          <div className="flex-1 min-w-0">
            <h1 className="text-base font-bold text-gray-800 truncate">{data.board.name}</h1>
            {data.label && <p className="text-xs text-gray-400">{data.label}</p>}
          </div>
          {/* 통계 */}
          <div className="hidden sm:flex items-center gap-4 text-sm">
            <div className="text-center">
              <p className="text-xl font-black text-gray-800">{data.stats.total}</p>
              <p className="text-xs text-gray-400">전체</p>
            </div>
            <div className="text-center">
              <p className="text-xl font-black text-green-600">{data.stats.resolveRate}%</p>
              <p className="text-xs text-gray-400">해결률</p>
            </div>
            {data.stats.criticalOpen > 0 && (
              <div className="text-center">
                <p className="text-xl font-black text-red-600">{data.stats.criticalOpen}</p>
                <p className="text-xs text-gray-400">Critical</p>
              </div>
            )}
          </div>
        </div>
        {/* 진행률 바 */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 pb-3">
          <div className="flex items-center gap-2">
            <div className="flex-1 bg-gray-200 rounded-full h-1.5">
              <div
                className="bg-green-500 h-1.5 rounded-full transition-all"
                style={{ width: `${data.stats.resolveRate}%` }}
              />
            </div>
            <span className="text-xs text-gray-400">{data.stats.resolved}/{data.stats.total} 해결</span>
          </div>
        </div>
      </header>

      {/* 필터 */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-2 flex-wrap">
        {(["all", "critical", "major", "minor", "trivial"] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`text-xs font-semibold px-3 py-1.5 rounded-full border transition-all ${
              filter === f
                ? "bg-blue-600 text-white border-blue-600"
                : "bg-white text-gray-600 border-gray-200 hover:border-blue-300"
            }`}
          >
            {f === "all" ? "전체" : SEV_CONFIG[f].label}
            {f !== "all" && (
              <span className="ml-1 opacity-70">
                {data.issues.filter(i => i.severity === f).length}
              </span>
            )}
          </button>
        ))}
        <span className="ml-auto text-xs text-gray-400">
          🔄 {lastUpdated.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })} 업데이트
        </span>
      </div>

      {/* Kanban 보드 */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 pb-12">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {STATUS_COLS.map(col => {
            const colIssues = byStatus(col.id);
            return (
              <div key={col.id} className="flex flex-col gap-3">
                <div className={`flex items-center gap-2 border-l-4 pl-2 ${col.color}`}>
                  <span className="font-bold text-sm text-gray-700">{col.label}</span>
                  <span className="ml-auto bg-gray-100 text-gray-600 text-xs font-bold px-2 py-0.5 rounded-full">
                    {colIssues.length}
                  </span>
                </div>
                {colIssues.length === 0 ? (
                  <div className="border-2 border-dashed border-gray-200 rounded-lg p-6 text-center text-xs text-gray-400">
                    이슈 없음
                  </div>
                ) : (
                  colIssues.map(issue => (
                    <IssueCard key={issue.id} issue={issue} onClick={() => setSelected(issue)} />
                  ))
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* 하단 바 */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t text-center py-2 text-xs text-gray-400">
        🟢 30초마다 자동 업데이트 &nbsp;·&nbsp; 조회수 {data.viewCount}&nbsp;·&nbsp;
        <a href="/" className="text-blue-500 hover:underline">QA Agent로 만들기</a>
      </div>

      {/* 이슈 상세 패널 */}
      {selected && <IssueDetail issue={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
