"use client";
import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import ProviderSwitcher from "./ProviderSwitcher";

interface User { id: string; email: string; name?: string; }

const HIDE_NAV = ["/login", "/register"];

export default function NavBar() {
  const router   = useRouter();
  const pathname = usePathname();
  const [user, setUser]       = useState<User | null>(null);
  const [showMenu, setShowMenu] = useState(false);

  useEffect(() => {
    if (HIDE_NAV.some(p => pathname.startsWith(p))) return;
    fetch("/api/auth/me").then(r => r.json()).then(d => setUser(d.user ?? null)).catch(() => {});
  }, [pathname]);

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    setUser(null);
    router.push("/login");
  };

  if (HIDE_NAV.some(p => pathname.startsWith(p))) return null;

  const navLink = (href: string, label: string) => (
    <a href={href}
      className={`text-sm font-medium transition-colors ${pathname.startsWith(href) ? "text-[#0052CC] font-bold" : "text-gray-600 hover:text-[#0052CC]"}`}>
      {label}
    </a>
  );

  return (
    <nav className="bg-white border-b border-gray-100 px-6 py-3 flex items-center gap-6 shrink-0 z-30">
      <a href="/board" className="flex items-center gap-2 shrink-0">
        <div className="w-7 h-7 bg-[#0052CC] rounded-lg flex items-center justify-center">
          <span className="text-white font-black text-xs">QA</span>
        </div>
        <span className="font-black text-gray-800">Agent</span>
      </a>

      <div className="flex items-center gap-4">
        {navLink("/human-agent", "Auto Agent")}
        {navLink("/board", "QA Board")}
        {navLink("/analytics", "애널리틱스")}
        {navLink("/reports", "Reports")}
        {navLink("/dashboard", "Dashboard")}
      </div>

      <div className="ml-auto flex items-center gap-3">
        <ProviderSwitcher />

        {user ? (
          <div className="relative">
            <button onClick={() => setShowMenu(p => !p)}
              className="flex items-center gap-2 bg-gray-50 hover:bg-gray-100 px-3 py-1.5 rounded-xl transition-colors">
              <div className="w-6 h-6 bg-[#0052CC] rounded-full flex items-center justify-center text-white text-xs font-black">
                {(user.name ?? user.email)[0].toUpperCase()}
              </div>
              <span className="text-sm font-semibold text-gray-700 max-w-[100px] truncate">{user.name ?? user.email}</span>
              <span className="text-gray-400 text-xs">▾</span>
            </button>
            {showMenu && (
              <div className="absolute right-0 top-full mt-2 w-48 bg-white rounded-xl shadow-xl border border-gray-200 py-2 z-50">
                <div className="px-4 py-2 border-b border-gray-100">
                  <p className="text-xs font-bold text-gray-800 truncate">{user.name}</p>
                  <p className="text-xs text-gray-400 truncate">{user.email}</p>
                </div>
                <a href="/settings/team" className="flex items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">👥 팀 설정</a>
                <a href="/settings/integrations" className="flex items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">🔌 연동 설정</a>
                <a href="/analytics" className="flex items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">📊 애널리틱스</a>
                <div className="border-t border-gray-100 mt-1">
                  <button onClick={handleLogout} className="w-full flex items-center gap-2 px-4 py-2 text-sm text-red-600 hover:bg-red-50">🚪 로그아웃</button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <a href="/login" className="text-sm font-bold px-4 py-1.5 bg-[#0052CC] text-white rounded-xl hover:bg-blue-700">로그인</a>
        )}
      </div>
    </nav>
  );
}
