"use client";
import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";

interface Team { id: string; name: string; myRole: string; }
interface Integration { id: string; type: string; config: Record<string, string>; isActive: boolean; }

const INTEGRATION_INFO = {
  slack: { icon: "💬", name: "Slack", desc: "이슈 생성/상태변경 시 채널에 알림을 보냅니다.", fields: [{ key: "webhookUrl", label: "Webhook URL", placeholder: "https://hooks.slack.com/services/..." }] },
  jira:  { icon: "🎯", name: "Jira",  desc: "이슈 생성 시 Jira 티켓을 자동으로 만듭니다.",  fields: [{ key: "host", label: "Jira URL", placeholder: "https://yourteam.atlassian.net" }, { key: "email", label: "계정 이메일", placeholder: "you@company.com" }, { key: "token", label: "API Token", placeholder: "Jira API 토큰" }, { key: "project", label: "프로젝트 키", placeholder: "QA" }] },
  email: { icon: "📧", name: "이메일 알림", desc: "담당자 배정 시 이메일을 보냅니다.", fields: [{ key: "smtpHost", label: "SMTP 호스트", placeholder: "smtp.gmail.com" }, { key: "smtpUser", label: "계정", placeholder: "you@gmail.com" }, { key: "smtpPass", label: "앱 비밀번호", placeholder: "앱 비밀번호" }] },
};

export default function IntegrationsPage() {
  const router = useRouter();
  const [teams, setTeams]   = useState<Team[]>([]);
  const [active, setActive] = useState<Team | null>(null);
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [formData, setFormData] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved]   = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  const loadTeams = useCallback(async () => {
    const d = await fetch("/api/teams").then(r => r.json());
    setTeams(d.teams ?? []);
    if (d.teams?.length > 0) setActive(d.teams[0]);
  }, []);

  const loadIntegrations = useCallback(async (teamId: string) => {
    const d = await fetch(`/api/teams/${teamId}/integrations`).then(r => r.json());
    setIntegrations(d.integrations ?? []);
  }, []);

  useEffect(() => { loadTeams(); }, [loadTeams]);
  useEffect(() => { if (active) loadIntegrations(active.id); }, [active, loadIntegrations]);

  const getIntegration = (type: string) => integrations.find(i => i.type === type);

  const startEdit = (type: string) => {
    const existing = getIntegration(type);
    setFormData(existing?.config ?? {});
    setEditing(type);
    setTestResult(null);
  };

  const handleSave = async (type: string) => {
    if (!active) return; setSaving(true); setSaved(false);
    await fetch(`/api/teams/${active.id}/integrations`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, config: formData, isActive: true }),
    });
    await loadIntegrations(active.id);
    setSaving(false); setSaved(true); setEditing(null);
    setTimeout(() => setSaved(false), 3000);
  };

  const handleToggle = async (type: string, isActive: boolean) => {
    if (!active) return;
    const existing = getIntegration(type);
    if (!existing) return;
    await fetch(`/api/teams/${active.id}/integrations`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, config: existing.config, isActive }),
    });
    await loadIntegrations(active.id);
  };

  const handleDelete = async (type: string) => {
    if (!active || !confirm("이 연동을 삭제할까요?")) return;
    await fetch(`/api/teams/${active.id}/integrations`, {
      method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type }),
    });
    await loadIntegrations(active.id);
  };

  const testSlack = async () => {
    if (!active) return;
    const d = await fetch(`/api/teams/${active.id}/integrations/test`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "slack" }),
    }).then(r => r.json()).catch(() => ({ ok: false }));
    setTestResult(d.ok ? "✅ Slack 연결 성공!" : "❌ 연결 실패. Webhook URL을 확인하세요.");
  };

  return (
    <div className="max-w-3xl mx-auto p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-black text-gray-800">외부 연동</h1>
          <p className="text-gray-500 text-sm mt-1">Slack, Jira 등과 연결하세요</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => router.push("/settings/team")} className="text-sm font-semibold px-4 py-2 border border-gray-200 rounded-xl text-gray-600 hover:bg-gray-50">👥 팀 설정</button>
          <button onClick={() => router.push("/board")} className="text-sm font-semibold px-4 py-2 bg-[#0052CC] text-white rounded-xl hover:bg-blue-700">보드로 이동</button>
        </div>
      </div>

      {/* 팀 선택 */}
      {teams.length > 1 && (
        <div className="flex gap-2 mb-6">
          {teams.map(t => (
            <button key={t.id} onClick={() => setActive(t)}
              className={`px-3 py-1.5 rounded-lg text-sm font-bold transition-all ${active?.id === t.id ? "bg-[#0052CC] text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>
              {t.name}
            </button>
          ))}
        </div>
      )}

      {saved && <div className="mb-4 bg-green-50 border border-green-200 text-green-700 text-sm px-4 py-3 rounded-xl">✅ 저장되었습니다.</div>}

      <div className="space-y-4">
        {(Object.entries(INTEGRATION_INFO) as [string, typeof INTEGRATION_INFO.slack][]).map(([type, info]) => {
          const existing = getIntegration(type);
          const isEditing = editing === type;

          return (
            <div key={type} className="bg-white rounded-2xl border border-gray-200 p-6">
              <div className="flex items-start gap-4">
                <div className="text-3xl">{info.icon}</div>
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-1">
                    <h3 className="font-black text-gray-800">{info.name}</h3>
                    {existing && (
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${existing.isActive ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                        {existing.isActive ? "● 활성" : "○ 비활성"}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-gray-500 mb-4">{info.desc}</p>

                  {isEditing ? (
                    <div className="space-y-3">
                      {info.fields.map(field => (
                        <div key={field.key}>
                          <label className="block text-xs font-bold text-gray-600 uppercase mb-1">{field.label}</label>
                          <input value={formData[field.key] ?? ""} onChange={e => setFormData(p => ({ ...p, [field.key]: e.target.value }))}
                            placeholder={field.placeholder}
                            className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
                        </div>
                      ))}
                      {testResult && <p className="text-sm">{testResult}</p>}
                      <div className="flex gap-2 pt-1">
                        {type === "slack" && <button onClick={testSlack} className="text-xs font-semibold px-3 py-2 border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50">테스트</button>}
                        <button onClick={() => setEditing(null)} className="flex-1 border border-gray-200 text-gray-600 py-2 rounded-xl text-sm hover:bg-gray-50">취소</button>
                        <button onClick={() => handleSave(type)} disabled={saving} className="flex-1 bg-[#0052CC] text-white py-2 rounded-xl text-sm font-bold hover:bg-blue-700 disabled:opacity-50">
                          {saving ? "저장 중..." : "저장"}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <button onClick={() => startEdit(type)} className="text-sm font-semibold px-4 py-2 bg-gray-100 text-gray-700 rounded-xl hover:bg-gray-200">
                        {existing ? "수정" : "설정하기"}
                      </button>
                      {existing && <>
                        <button onClick={() => handleToggle(type, !existing.isActive)}
                          className={`text-sm font-semibold px-4 py-2 rounded-xl ${existing.isActive ? "bg-yellow-50 text-yellow-700 hover:bg-yellow-100" : "bg-green-50 text-green-700 hover:bg-green-100"}`}>
                          {existing.isActive ? "비활성화" : "활성화"}
                        </button>
                        <button onClick={() => handleDelete(type)} className="text-sm font-semibold px-4 py-2 bg-red-50 text-red-600 rounded-xl hover:bg-red-100">삭제</button>
                      </>}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
