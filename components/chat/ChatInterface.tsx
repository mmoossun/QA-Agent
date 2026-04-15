"use client";

import { useState, useRef, useEffect } from "react";
import type { QAScenario, TestResult } from "@/lib/ai/types";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  scenarios?: QAScenario[];
  results?: TestResult[];
  timestamp: Date;
}

interface ChatInterfaceProps {
  defaultUrl?: string;
}

export function ChatInterface({ defaultUrl = "" }: ChatInterfaceProps) {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      role: "assistant",
      content: "안녕하세요! 테스트하고 싶은 기능을 자연어로 입력해주세요.\n예: \"로그인 기능을 정상/비정상 케이스로 테스트해줘\" 또는 \"채팅 위젯 열기 및 메시지 전송 테스트\"",
      timestamp: new Date(),
    },
  ]);
  const [input, setInput] = useState("");
  const [targetUrl, setTargetUrl] = useState(defaultUrl);
  const [executeNow, setExecuteNow] = useState(false);
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = async () => {
    if (!input.trim() || loading) return;

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: input,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);

    try {
      const history = messages
        .filter((m) => m.id !== "welcome")
        .map((m) => ({ role: m.role, content: m.content }));

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: input,
          history,
          executeNow,
          targetUrl: targetUrl || undefined,
        }),
      });

      const data = await res.json();

      const assistantMsg: Message = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: data.message ?? "시나리오가 생성되었습니다.",
        scenarios: data.scenarios,
        results: data.results,
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: `오류가 발생했습니다: ${err}`,
          timestamp: new Date(),
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* URL bar */}
      <div className="p-4 border-b bg-white flex gap-3 items-center">
        <input
          className="input flex-1 text-xs"
          placeholder="테스트 대상 URL (선택 사항) — https://app-dev.example.com"
          value={targetUrl}
          onChange={(e) => setTargetUrl(e.target.value)}
        />
        <label className="flex items-center gap-2 text-sm text-gray-600 whitespace-nowrap cursor-pointer select-none">
          <input
            type="checkbox"
            checked={executeNow}
            onChange={(e) => setExecuteNow(e.target.checked)}
            className="w-4 h-4 rounded"
          />
          바로 실행
        </label>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
        {loading && (
          <div className="flex gap-3">
            <div className="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center text-white text-xs shrink-0">
              AI
            </div>
            <div className="card px-4 py-3 flex items-center gap-2 text-sm text-gray-500">
              <span className="flex gap-1">
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    className="w-2 h-2 bg-blue-400 rounded-full animate-bounce"
                    style={{ animationDelay: `${i * 0.15}s` }}
                  />
                ))}
              </span>
              Claude가 시나리오를 생성 중입니다...
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="p-4 border-t bg-white">
        <div className="flex gap-3">
          <textarea
            className="input flex-1 resize-none text-sm"
            rows={2}
            placeholder='예: "로그인/로그아웃 기능을 정상 + 실패 케이스로 테스트해줘"'
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
              }
            }}
          />
          <button
            onClick={sendMessage}
            disabled={!input.trim() || loading}
            className="btn-primary self-end"
          >
            전송
          </button>
        </div>
        <p className="text-xs text-gray-400 mt-1.5">Enter로 전송 | Shift+Enter 줄바꿈</p>
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === "user";

  return (
    <div className={`flex gap-3 ${isUser ? "flex-row-reverse" : ""}`}>
      <div
        className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium shrink-0 ${
          isUser ? "bg-gray-200 text-gray-600" : "bg-blue-600 text-white"
        }`}
      >
        {isUser ? "You" : "AI"}
      </div>

      <div className={`max-w-[80%] space-y-3 ${isUser ? "items-end" : ""}`}>
        <div
          className={`px-4 py-3 rounded-xl text-sm whitespace-pre-wrap ${
            isUser ? "bg-blue-600 text-white ml-auto" : "card text-gray-700"
          }`}
        >
          {message.content}
        </div>

        {/* Scenarios */}
        {message.scenarios && message.scenarios.length > 0 && (
          <ScenarioList scenarios={message.scenarios} results={message.results} />
        )}
      </div>
    </div>
  );
}

function ScenarioList({ scenarios, results }: { scenarios: QAScenario[]; results?: TestResult[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <div className="card overflow-hidden">
      <div className="px-4 py-2 bg-gray-50 border-b text-xs font-medium text-gray-500">
        생성된 시나리오 ({scenarios.length}개)
      </div>
      <div className="divide-y">
        {scenarios.map((s) => {
          const result = results?.find((r) => r.scenarioId === s.id);
          return (
            <div key={s.id}>
              <button
                className="w-full px-4 py-3 text-left flex items-center gap-3 hover:bg-gray-50 transition-colors"
                onClick={() => setExpanded(expanded === s.id ? null : s.id)}
              >
                <span
                  className={`w-2 h-2 rounded-full shrink-0 ${
                    s.priority === "critical"
                      ? "bg-red-500"
                      : s.priority === "high"
                      ? "bg-orange-400"
                      : "bg-blue-400"
                  }`}
                />
                <span className="text-sm font-medium flex-1">{s.name}</span>
                {result && (
                  <span className={`badge-${result.status}`}>{result.status.toUpperCase()}</span>
                )}
                <span className="text-gray-400 text-xs">{s.steps.length} steps</span>
                <svg
                  className={`w-4 h-4 text-gray-400 transition-transform ${expanded === s.id ? "rotate-180" : ""}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {expanded === s.id && (
                <div className="px-4 pb-4 text-xs text-gray-500 space-y-2">
                  <div>
                    <span className="font-medium text-gray-700">Category:</span> {s.category} |{" "}
                    <span className="font-medium text-gray-700">Priority:</span> {s.priority}
                  </div>
                  <div>
                    <div className="font-medium text-gray-700 mb-1">Steps:</div>
                    <ol className="space-y-1 list-decimal list-inside">
                      {s.steps.map((step, i) => (
                        <li key={i}>{step.description}</li>
                      ))}
                    </ol>
                  </div>
                  <div>
                    <span className="font-medium text-gray-700">Expected:</span> {s.expectedResult}
                  </div>
                  {result?.errorMessage && (
                    <div className="bg-red-50 text-red-600 p-2 rounded">
                      Error: {result.errorMessage}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
