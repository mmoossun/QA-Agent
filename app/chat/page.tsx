import { ChatInterface } from "@/components/chat/ChatInterface";

export default function ChatPage() {
  return (
    <div className="h-[calc(100vh-57px)] flex flex-col">
      <div className="px-6 py-4 border-b bg-white">
        <h1 className="text-lg font-semibold text-gray-900">Chat QA</h1>
        <p className="text-sm text-gray-500">자연어로 테스트 시나리오를 생성하고 즉시 실행하세요</p>
      </div>
      <div className="flex-1 overflow-hidden">
        <ChatInterface defaultUrl="https://app-dev.generativelab.co.kr" />
      </div>
    </div>
  );
}
