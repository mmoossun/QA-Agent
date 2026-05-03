"use client";
import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";

interface User { id: string; name?: string; email: string; avatar?: string; }
interface Member { id: string; role: string; user: User; joinedAt: string; }
interface Team { id: string; name: string; slug: string; plan: string; myRole: string; _count: { members: number; boards: number }; members: Member[]; }
interface Invite { id: string; email: string; role: string; expiresAt: string; createdAt: string; }

const ROLE_LABELS: Record<string, string> = { owner: "👑 소유자", admin: "🔧 관리자", member: "👤 멤버", viewer: "👁 뷰어" };
const PLAN_LABELS: Record<string, string> = { free: "무료", pro: "Pro", team: "Team" };

export default function TeamSettingsPage() {
  const router = useRouter();
  const [teams, setTeams]       = useState<Team[]>([]);
  const [active, setActive]     = useState<Team | null>(null);
  const [invites, setInvites]   = useState<Invite[]>([]);
  const [loading, setLoading]   = useState(true);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole]   = useState("member");
  const [inviting, setInviting] = useState(false);
  const [inviteUrl, setInviteUrl]   = useState("");
  const [newTeamName, setNewTeamName] = useState("");
  const [creating, setCreating] = useState(false);
  const [showCreate, setShowCreate] = useState(false);

  const loadTeams = useCallback(async () => {
    const d = await fetch("/api/teams").then(r => r.json());
    setTeams(d.teams ?? []);
    if (d.teams?.length > 0) setActive(d.teams[0]);
    setLoading(false);
  }, []);

  const loadInvites = useCallback(async (teamId: string) => {
    const d = await fetch(`/api/teams/${teamId}/invite`).then(r => r.json());
    setInvites(d.invites ?? []);
  }, []);

  useEffect(() => { loadTeams(); }, [loadTeams]);
  useEffect(() => { if (active) loadInvites(active.id); }, [active, loadInvites]);

  const handleInvite = async () => {
    if (!inviteEmail.trim() || !active) return;
    setInviting(true);
    const d = await fetch(`/api/teams/${active.id}/invite`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
    }).then(r => r.json());
    if (d.inviteUrl) { setInviteUrl(d.inviteUrl); await navigator.clipboard.writeText(d.inviteUrl).catch(() => {}); }
    setInviteEmail(""); await loadInvites(active.id); setInviting(false);
  };

  const handleCreateTeam = async () => {
    if (!newTeamName.trim()) return; setCreating(true);
    const d = await fetch("/api/teams", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newTeamName }),
    }).then(r => r.json());
    if (d.team) { await loadTeams(); setNewTeamName(""); setShowCreate(false); }
    setCreating(false);
  };

  const handleRoleChange = async (userId: string, role: string) => {
    if (!active) return;
    await fetch(`/api/teams/${active.id}/members`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId, role }) });
    await loadTeams();
  };

  const handleRemoveMember = async (userId: string) => {
    if (!active || !confirm("이 멤버를 팀에서 제거할까요?")) return;
    await fetch(`/api/teams/${active.id}/members`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId }) });
    await loadTeams();
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center"><div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" /></div>;

  return (
    <div className="max-w-3xl mx-auto p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-black text-gray-800">팀 설정</h1>
          <p className="text-gray-500 text-sm mt-1">팀 멤버를 관리하고 초대하세요</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => router.push("/settings/integrations")} className="text-sm font-semibold px-4 py-2 border border-gray-200 rounded-xl text-gray-600 hover:bg-gray-50">🔌 연동 설정</button>
          <button onClick={() => router.push("/board")} className="text-sm font-semibold px-4 py-2 bg-[#0052CC] text-white rounded-xl hover:bg-blue-700">보드로 이동</button>
        </div>
      </div>

      {teams.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-200 p-12 text-center">
          <p className="text-4xl mb-4">👥</p>
          <h2 className="text-xl font-bold text-gray-700 mb-2">아직 팀이 없습니다</h2>
          <p className="text-gray-500 text-sm mb-6">팀을 만들어 동료를 초대하고 보드를 공유하세요</p>
          <button onClick={() => setShowCreate(true)} className="bg-[#0052CC] text-white px-6 py-2.5 rounded-xl font-bold hover:bg-blue-700">+ 팀 만들기</button>
        </div>
      ) : (
        <div className="space-y-6">
          {/* 팀 선택 탭 */}
          <div className="flex gap-2 flex-wrap">
            {teams.map(t => (
              <button key={t.id} onClick={() => setActive(t)}
                className={`px-4 py-2 rounded-xl text-sm font-bold transition-all ${active?.id === t.id ? "bg-[#0052CC] text-white" : "bg-white border border-gray-200 text-gray-600 hover:border-blue-300"}`}>
                {t.name}
                <span className={`ml-1.5 text-xs ${active?.id === t.id ? "text-blue-200" : "text-gray-400"}`}>{PLAN_LABELS[t.plan]}</span>
              </button>
            ))}
            <button onClick={() => setShowCreate(!showCreate)} className="px-4 py-2 rounded-xl text-sm font-bold bg-gray-100 text-gray-600 hover:bg-gray-200">+ 새 팀</button>
          </div>

          {/* 팀 만들기 폼 */}
          {showCreate && (
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex gap-2">
              <input value={newTeamName} onChange={e => setNewTeamName(e.target.value)} placeholder="팀 이름"
                className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
              <button onClick={handleCreateTeam} disabled={creating}
                className="bg-[#0052CC] text-white px-4 py-2 rounded-lg text-sm font-bold hover:bg-blue-700 disabled:opacity-50">
                {creating ? "..." : "만들기"}
              </button>
              <button onClick={() => setShowCreate(false)} className="text-gray-400 hover:text-gray-600 px-2">✕</button>
            </div>
          )}

          {active && (
            <>
              {/* 팀 정보 */}
              <div className="bg-white rounded-2xl border border-gray-200 p-6">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h2 className="text-lg font-black text-gray-800">{active.name}</h2>
                    <p className="text-xs text-gray-400">슬러그: {active.slug} · {active._count.members}명 · {active._count.boards}개 보드</p>
                  </div>
                  <span className={`text-xs font-bold px-3 py-1 rounded-full ${active.plan === "free" ? "bg-gray-100 text-gray-600" : "bg-blue-100 text-blue-700"}`}>
                    {PLAN_LABELS[active.plan]}
                  </span>
                </div>

                {/* 멤버 목록 */}
                <div className="space-y-2">
                  {active.members?.map(m => (
                    <div key={m.id} className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
                      <div className="w-8 h-8 bg-[#0052CC] rounded-full flex items-center justify-center text-white text-sm font-black shrink-0">
                        {(m.user.name ?? m.user.email)[0].toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-gray-800 truncate">{m.user.name ?? m.user.email}</p>
                        <p className="text-xs text-gray-400">{m.user.email}</p>
                      </div>
                      {active.myRole === "owner" && m.role !== "owner" ? (
                        <div className="flex items-center gap-2">
                          <select value={m.role} onChange={e => handleRoleChange(m.user.id, e.target.value)}
                            className="text-xs border border-gray-200 rounded-lg px-2 py-1 focus:outline-none">
                            <option value="admin">관리자</option>
                            <option value="member">멤버</option>
                            <option value="viewer">뷰어</option>
                          </select>
                          <button onClick={() => handleRemoveMember(m.user.id)} className="text-xs text-red-500 hover:text-red-700 px-1">제거</button>
                        </div>
                      ) : (
                        <span className="text-xs text-gray-500 font-semibold">{ROLE_LABELS[m.role]}</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* 초대 */}
              <div className="bg-white rounded-2xl border border-gray-200 p-6">
                <h3 className="font-black text-gray-800 mb-4">멤버 초대</h3>
                <div className="flex gap-2 mb-3">
                  <input value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} placeholder="이메일 주소" type="email"
                    className="flex-1 border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
                  <select value={inviteRole} onChange={e => setInviteRole(e.target.value)}
                    className="border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none">
                    <option value="member">멤버</option>
                    <option value="admin">관리자</option>
                    <option value="viewer">뷰어</option>
                  </select>
                  <button onClick={handleInvite} disabled={inviting || !inviteEmail.trim()}
                    className="bg-[#0052CC] text-white px-5 py-2.5 rounded-xl text-sm font-bold hover:bg-blue-700 disabled:opacity-50">
                    {inviting ? "..." : "초대"}
                  </button>
                </div>
                {inviteUrl && (
                  <div className="bg-green-50 border border-green-200 rounded-xl p-3 flex items-center gap-2">
                    <span className="text-green-600 text-sm">✅ 클립보드에 복사됨:</span>
                    <span className="text-xs text-gray-600 truncate flex-1 font-mono">{inviteUrl}</span>
                    <button onClick={() => setInviteUrl("")} className="text-gray-400 hover:text-gray-600 text-xs">✕</button>
                  </div>
                )}
                {/* 대기 중인 초대 */}
                {invites.length > 0 && (
                  <div className="mt-4">
                    <p className="text-xs font-bold text-gray-500 uppercase mb-2">대기 중인 초대 ({invites.length})</p>
                    {invites.map(inv => (
                      <div key={inv.id} className="flex items-center gap-2 text-xs text-gray-500 py-1.5 border-b border-gray-100 last:border-0">
                        <span className="flex-1">{inv.email}</span>
                        <span className="bg-gray-100 px-2 py-0.5 rounded">{inv.role}</span>
                        <span>{new Date(inv.expiresAt).toLocaleDateString("ko-KR")} 만료</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
