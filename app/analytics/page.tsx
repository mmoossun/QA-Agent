"use client";
import { useEffect, useState } from "react";

interface Board { id: string; name: string; boardKey: string; }
interface Analytics {
  summary: { total: number; done: number; doneRate: number; avgCycleHours: number; totalPoints: number; donePoints: number };
  byStatus: Record<string, number>;
  byPriority: Record<string, number>;
  byType: Record<string, number>;
  byAssignee: Record<string, number>;
  sprintVelocity: { name: string; total: number; done: number }[];
  trend: { date: string; created: number; resolved: number }[];
}

const PRI_COLOR: Record<string, string> = { critical: "#ef4444", high: "#f97316", medium: "#eab308", low: "#3b82f6" };
const PRI_LABEL: Record<string, string> = { critical: "⛔ Critical", high: "🔴 High", medium: "🟡 Medium", low: "🔵 Low" };
const ST_COLOR:  Record<string, string> = { todo: "#94a3b8", in_progress: "#3b82f6", in_review: "#8b5cf6", done: "#22c55e", wont_fix: "#9ca3af" };
const ST_LABEL:  Record<string, string> = { todo: "할 일", in_progress: "진행 중", in_review: "검토 중", done: "완료", wont_fix: "해결 안 함" };

function Bar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.round(value / max * 100) : 0;
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-gray-600 w-24 shrink-0 truncate">{label}</span>
      <div className="flex-1 bg-gray-100 rounded-full h-2">
        <div className="h-2 rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <span className="text-xs font-bold text-gray-700 w-6 text-right">{value}</span>
    </div>
  );
}

function TrendChart({ data }: { data: Analytics["trend"] }) {
  const maxVal = Math.max(...data.flatMap(d => [d.created, d.resolved]), 1);
  const h = 80;
  const w = 100 / data.length;

  return (
    <div className="relative">
      <svg viewBox={`0 0 100 ${h}`} className="w-full" style={{ height: 100 }} preserveAspectRatio="none">
        {/* Grid */}
        {[0.25, 0.5, 0.75].map(r => (
          <line key={r} x1="0" y1={h * (1 - r)} x2="100" y2={h * (1 - r)} stroke="#e5e7eb" strokeWidth="0.5" />
        ))}
        {/* Created bars */}
        {data.map((d, i) => {
          const bh = (d.created / maxVal) * h;
          return <rect key={i} x={i * w + w * 0.1} y={h - bh} width={w * 0.35} height={bh} fill="#3b82f6" opacity="0.7" rx="1" />;
        })}
        {/* Resolved bars */}
        {data.map((d, i) => {
          const bh = (d.resolved / maxVal) * h;
          return <rect key={i} x={i * w + w * 0.55} y={h - bh} width={w * 0.35} height={bh} fill="#22c55e" opacity="0.7" rx="1" />;
        })}
      </svg>
      <div className="flex mt-1">
        {data.map((d, i) => (
          <div key={i} className="text-center text-[9px] text-gray-400 flex-1">{d.date}</div>
        ))}
      </div>
      <div className="flex items-center gap-4 mt-2 justify-center">
        <div className="flex items-center gap-1"><div className="w-3 h-2 bg-blue-400 rounded opacity-70" /><span className="text-[10px] text-gray-500">생성</span></div>
        <div className="flex items-center gap-1"><div className="w-3 h-2 bg-green-400 rounded opacity-70" /><span className="text-[10px] text-gray-500">완료</span></div>
      </div>
    </div>
  );
}

export default function AnalyticsPage() {
  const [boards, setBoards]   = useState<Board[]>([]);
  const [active, setActive]   = useState<Board | null>(null);
  const [data, setData]       = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch("/api/boards").then(r => r.json()).then(d => {
      setBoards(d.boards ?? []);
      if (d.boards?.length > 0) setActive(d.boards[0]);
    });
  }, []);

  useEffect(() => {
    if (!active) return;
    setLoading(true);
    fetch(`/api/boards/${active.id}/analytics`)
      .then(r => r.json())
      .then(d => setData(d))
      .finally(() => setLoading(false));
  }, [active]);

  return (
    <div className="max-w-5xl mx-auto p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-black text-gray-800">애널리틱스</h1>
          <p className="text-gray-500 text-sm mt-1">이슈 현황과 스프린트 속도를 분석합니다</p>
        </div>
        <div className="flex items-center gap-3">
          {active && (
            <a href={`/api/boards/${active.id}/export`} download
              className="text-sm font-semibold px-4 py-2 border border-gray-200 rounded-xl text-gray-600 hover:bg-gray-50">
              ⬇ CSV 내보내기
            </a>
          )}
          <a href="/board" className="text-sm font-semibold px-4 py-2 bg-[#0052CC] text-white rounded-xl hover:bg-blue-700">보드로 이동</a>
        </div>
      </div>

      {/* 보드 선택 */}
      <div className="flex gap-2 flex-wrap mb-6">
        {boards.map(b => (
          <button key={b.id} onClick={() => setActive(b)}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-bold transition-all ${active?.id === b.id ? "bg-[#0052CC] text-white" : "bg-white border border-gray-200 text-gray-600 hover:border-blue-300"}`}>
            <span className="font-mono text-xs">{b.boardKey}</span> {b.name}
          </button>
        ))}
      </div>

      {loading && <div className="text-center py-20 text-gray-400">분석 중...</div>}

      {data && !loading && (
        <div className="space-y-5">
          {/* 요약 카드 */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {[
              { label: "전체 이슈", value: data.summary.total, color: "text-gray-800" },
              { label: "완료", value: data.summary.done, color: "text-green-600" },
              { label: "완료율", value: `${data.summary.doneRate}%`, color: "text-[#0052CC]" },
              { label: "평균 사이클", value: `${data.summary.avgCycleHours}h`, color: "text-purple-600" },
              { label: "총 SP", value: data.summary.totalPoints, color: "text-yellow-600" },
              { label: "완료 SP", value: data.summary.donePoints, color: "text-green-600" },
            ].map(({ label, value, color }) => (
              <div key={label} className="bg-white rounded-xl border border-gray-200 p-4 text-center">
                <p className={`text-2xl font-black ${color}`}>{value}</p>
                <p className="text-xs text-gray-400 mt-1">{label}</p>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* 이슈 추이 */}
            <div className="bg-white rounded-2xl border border-gray-200 p-5">
              <h3 className="font-black text-gray-800 mb-4">7일 이슈 추이</h3>
              <TrendChart data={data.trend} />
            </div>

            {/* 상태별 분포 */}
            <div className="bg-white rounded-2xl border border-gray-200 p-5">
              <h3 className="font-black text-gray-800 mb-4">상태별 분포</h3>
              <div className="space-y-2.5">
                {Object.entries(data.byStatus).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
                  <Bar key={k} label={ST_LABEL[k] ?? k} value={v} max={data.summary.total} color={ST_COLOR[k] ?? "#94a3b8"} />
                ))}
              </div>
            </div>

            {/* 우선순위별 */}
            <div className="bg-white rounded-2xl border border-gray-200 p-5">
              <h3 className="font-black text-gray-800 mb-4">우선순위별 분포</h3>
              <div className="space-y-2.5">
                {Object.entries(data.byPriority).sort((a, b) => {
                  const o = { critical: 0, high: 1, medium: 2, low: 3 } as Record<string, number>;
                  return (o[a[0]] ?? 9) - (o[b[0]] ?? 9);
                }).map(([k, v]) => (
                  <Bar key={k} label={PRI_LABEL[k] ?? k} value={v} max={data.summary.total} color={PRI_COLOR[k] ?? "#94a3b8"} />
                ))}
              </div>
            </div>

            {/* 담당자별 */}
            <div className="bg-white rounded-2xl border border-gray-200 p-5">
              <h3 className="font-black text-gray-800 mb-4">담당자별 이슈</h3>
              {Object.keys(data.byAssignee).length === 0
                ? <p className="text-sm text-gray-400 py-4 text-center">담당자가 배정된 이슈가 없습니다</p>
                : <div className="space-y-2.5">
                    {Object.entries(data.byAssignee).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
                      <Bar key={k} label={k} value={v} max={Math.max(...Object.values(data.byAssignee))} color="#0052CC" />
                    ))}
                  </div>
              }
            </div>
          </div>

          {/* 스프린트 속도 */}
          {data.sprintVelocity.length > 0 && (
            <div className="bg-white rounded-2xl border border-gray-200 p-5">
              <h3 className="font-black text-gray-800 mb-4">스프린트 속도 (완료 SP)</h3>
              <div className="flex items-end gap-4 h-32 overflow-x-auto pb-2">
                {data.sprintVelocity.map((s, i) => {
                  const maxPts = Math.max(...data.sprintVelocity.map(x => x.total), 1);
                  return (
                    <div key={i} className="flex flex-col items-center gap-1 shrink-0 min-w-[60px]">
                      <div className="relative w-10 flex flex-col justify-end" style={{ height: 96 }}>
                        <div className="w-full bg-gray-100 rounded-t-lg absolute bottom-0" style={{ height: `${s.total / maxPts * 100}%` }} />
                        <div className="w-full bg-[#0052CC] rounded-t-lg absolute bottom-0 opacity-80" style={{ height: `${s.done / maxPts * 100}%` }} />
                      </div>
                      <span className="text-[10px] text-gray-500 text-center leading-tight">{s.name}</span>
                      <span className="text-[10px] font-bold text-[#0052CC]">{s.done}/{s.total}</span>
                    </div>
                  );
                })}
              </div>
              <div className="flex items-center gap-4 mt-2">
                <div className="flex items-center gap-1"><div className="w-3 h-2 bg-gray-200 rounded" /><span className="text-[10px] text-gray-500">계획</span></div>
                <div className="flex items-center gap-1"><div className="w-3 h-2 bg-[#0052CC] rounded opacity-80" /><span className="text-[10px] text-gray-500">완료</span></div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
