"use client";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

function LoginForm() {
  const router = useRouter();
  const next   = useSearchParams().get("next") ?? "/board";
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [error, setError]       = useState("");
  const [loading, setLoading]   = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true); setError("");
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const d = await res.json();
    if (d.error) { setError(d.error); setLoading(false); }
    else router.push(next);
  };

  return (
    <div className="bg-white rounded-2xl shadow-lg p-8">
      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-xl">{error}</div>
      )}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-xs font-bold text-gray-600 uppercase tracking-wide mb-1.5">이메일</label>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} required autoFocus
            placeholder="name@company.com"
            className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
        </div>
        <div>
          <label className="block text-xs font-bold text-gray-600 uppercase tracking-wide mb-1.5">비밀번호</label>
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} required
            placeholder="••••••••"
            className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
        </div>
        <button type="submit" disabled={loading}
          className="w-full bg-[#0052CC] text-white py-3 rounded-xl font-black hover:bg-blue-700 disabled:opacity-50 transition-colors mt-2">
          {loading ? "로그인 중..." : "로그인"}
        </button>
      </form>
      <p className="text-center text-sm text-gray-500 mt-5">
        계정이 없으신가요?{" "}
        <Link href="/register" className="text-[#0052CC] font-bold hover:underline">회원가입</Link>
      </p>
    </div>
  );
}

export default function LoginPage() {
  return (
    <div className="min-h-screen bg-[#F4F5F7] flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-12 h-12 bg-[#0052CC] rounded-2xl mb-4">
            <span className="text-white font-black text-lg">QA</span>
          </div>
          <h1 className="text-2xl font-black text-gray-800">로그인</h1>
          <p className="text-gray-500 text-sm mt-1">QA Board에 오신 것을 환영합니다</p>
        </div>
        <Suspense fallback={<div className="bg-white rounded-2xl shadow-lg p-8 text-center text-gray-400">로딩 중...</div>}>
          <LoginForm />
        </Suspense>
      </div>
    </div>
  );
}
