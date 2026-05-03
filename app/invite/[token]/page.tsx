"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";

export default function InvitePage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const [info, setInfo]     = useState<{ team: string; email: string; role: string } | null>(null);
  const [error, setError]   = useState("");
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    fetch(`/api/invite/${token}`)
      .then(r => r.json())
      .then(d => { if (d.error) setError(d.error); else setInfo(d); })
      .finally(() => setLoading(false));
  }, [token]);

  const handleAccept = async () => {
    setJoining(true);
    const res = await fetch(`/api/invite/${token}/accept`, { method: "POST" });
    const d = await res.json();
    if (d.error) { setError(d.error); setJoining(false); }
    else router.push("/settings/team");
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center"><div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" /></div>;

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-8 text-center">
        <div className="text-5xl mb-4">🎉</div>
        {error ? (
          <>
            <h1 className="text-xl font-black text-gray-800 mb-2">초대 링크 오류</h1>
            <p className="text-gray-500 text-sm">{error}</p>
            <button onClick={() => router.push("/login")} className="mt-6 w-full bg-[#0052CC] text-white py-2.5 rounded-xl font-bold">로그인하기</button>
          </>
        ) : info ? (
          <>
            <h1 className="text-xl font-black text-gray-800 mb-2"><span className="text-[#0052CC]">{info.team}</span> 팀에 초대됐습니다</h1>
            <p className="text-gray-500 text-sm mb-1">{info.email}</p>
            <span className="text-xs bg-blue-100 text-blue-700 px-3 py-1 rounded-full font-bold">{info.role}</span>
            <button onClick={handleAccept} disabled={joining}
              className="mt-6 w-full bg-[#0052CC] text-white py-3 rounded-xl font-black hover:bg-blue-700 disabled:opacity-50 transition-colors">
              {joining ? "참여 중..." : "팀 합류하기"}
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}
