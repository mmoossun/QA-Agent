"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function RegisterPage() {
  const router = useRouter();
  const [f, setF]           = useState({ name: "", email: "", password: "", confirm: "" });
  const [error, setError]   = useState("");
  const [loading, setLoading] = useState(false);
  const u = (k: string, v: string) => setF(p => ({ ...p, [k]: v }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (f.password !== f.confirm) { setError("비밀번호가 일치하지 않습니다."); return; }
    if (f.password.length < 6) { setError("비밀번호는 6자 이상이어야 합니다."); return; }
    setLoading(true); setError("");
    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: f.name, email: f.email, password: f.password }),
    });
    const d = await res.json();
    if (d.error) { setError(d.error); setLoading(false); }
    else router.push("/board");
  };

  return (
    <div className="min-h-screen bg-[#F4F5F7] flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-12 h-12 bg-[#0052CC] rounded-2xl mb-4">
            <span className="text-white font-black text-lg">QA</span>
          </div>
          <h1 className="text-2xl font-black text-gray-800">회원가입</h1>
          <p className="text-gray-500 text-sm mt-1">팀과 함께 QA를 시작하세요</p>
        </div>

        <div className="bg-white rounded-2xl shadow-lg p-8">
          {error && (
            <div className="mb-4 bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-xl">{error}</div>
          )}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-gray-600 uppercase tracking-wide mb-1.5">이름</label>
              <input value={f.name} onChange={e => u("name", e.target.value)} required autoFocus placeholder="홍길동"
                className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-600 uppercase tracking-wide mb-1.5">이메일</label>
              <input type="email" value={f.email} onChange={e => u("email", e.target.value)} required placeholder="name@company.com"
                className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-600 uppercase tracking-wide mb-1.5">비밀번호</label>
              <input type="password" value={f.password} onChange={e => u("password", e.target.value)} required placeholder="6자 이상"
                className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-600 uppercase tracking-wide mb-1.5">비밀번호 확인</label>
              <input type="password" value={f.confirm} onChange={e => u("confirm", e.target.value)} required placeholder="비밀번호 재입력"
                className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
            </div>
            <button type="submit" disabled={loading}
              className="w-full bg-[#0052CC] text-white py-3 rounded-xl font-black hover:bg-blue-700 disabled:opacity-50 transition-colors mt-2">
              {loading ? "가입 중..." : "계정 만들기"}
            </button>
          </form>
          <p className="text-center text-sm text-gray-500 mt-5">
            이미 계정이 있으신가요?{" "}
            <Link href="/login" className="text-[#0052CC] font-bold hover:underline">로그인</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
