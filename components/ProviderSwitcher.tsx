"use client";

import { useEffect, useState } from "react";

type Provider = "claude" | "openai";

interface ProviderState {
  provider: Provider;
  hasOpenAI: boolean;
  hasClaude: boolean;
}

export default function ProviderSwitcher() {
  const [state, setState] = useState<ProviderState | null>(null);
  const [switching, setSwitching] = useState(false);

  useEffect(() => {
    fetch("/api/config/provider")
      .then((r) => r.json())
      .then(setState)
      .catch(() => {});
  }, []);

  const toggle = async () => {
    if (!state || switching) return;
    const next: Provider = state.provider === "claude" ? "openai" : "claude";
    setSwitching(true);
    try {
      const res = await fetch("/api/config/provider", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: next }),
      });
      const data = await res.json();
      if (data.ok) setState((s) => s ? { ...s, provider: next } : s);
    } finally {
      setSwitching(false);
    }
  };

  if (!state) return null;

  const isClaude = state.provider === "claude";
  const label = isClaude ? "Claude" : "OpenAI";
  const color = isClaude
    ? "bg-orange-50 text-orange-700 border-orange-200 hover:bg-orange-100"
    : "bg-green-50 text-green-700 border-green-200 hover:bg-green-100";

  return (
    <button
      onClick={toggle}
      disabled={switching}
      title={`현재 AI: ${label} — 클릭하여 전환`}
      className={`ml-auto flex items-center gap-1.5 text-xs font-medium border rounded-full px-2.5 py-1 transition-colors ${color} ${switching ? "opacity-50 cursor-wait" : "cursor-pointer"}`}
    >
      <span className="w-2 h-2 rounded-full bg-current opacity-70" />
      {switching ? "전환 중…" : label}
    </button>
  );
}
