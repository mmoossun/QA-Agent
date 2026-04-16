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
  useEffect(() => {
    fetch("/api/config/provider")
      .then((r) => r.json())
      .then(setState)
      .catch(() => {});
  }, []);

  if (!state) return null;

  const isClaude = state.provider === "claude";
  const label = isClaude ? "Claude" : "OpenAI";
  const color = isClaude
    ? "bg-orange-50 text-orange-700 border-orange-200"
    : "bg-green-50 text-green-700 border-green-200";

  return (
    <span
      title={`현재 AI: ${label}`}
      className={`ml-auto flex items-center gap-1.5 text-xs font-medium border rounded-full px-2.5 py-1 ${color}`}
    >
      <span className="w-2 h-2 rounded-full bg-current opacity-70" />
      {label}
    </span>
  );
}
