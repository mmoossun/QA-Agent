export default function DashboardPage() {
  return (
    <div className="max-w-5xl mx-auto px-6 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">Dashboard</h1>
        <p className="text-gray-500">QA 실행 기록 및 점수 추이</p>
      </div>

      {/* Score summary */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        {[
          { label: "Current Score", value: "—", color: "text-blue-600" },
          { label: "Total Runs", value: "—", color: "text-gray-700" },
          { label: "Avg Pass Rate", value: "—", color: "text-green-600" },
          { label: "Bugs Found", value: "—", color: "text-red-600" },
        ].map((s) => (
          <div key={s.label} className="card p-5">
            <div className={`text-3xl font-bold ${s.color}`}>{s.value}</div>
            <div className="text-xs text-gray-500 mt-1">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Recent runs placeholder */}
      <div className="card p-6">
        <h2 className="font-semibold text-gray-900 mb-4">Recent QA Runs</h2>
        <div className="text-sm text-gray-400 text-center py-12">
          QA 실행 이력이 여기에 표시됩니다.<br />
          <a href="/chat" className="text-blue-500 hover:underline">Chat QA</a> 또는{" "}
          <a href="/agent" className="text-blue-500 hover:underline">Auto Agent</a>를 먼저 실행해보세요.
        </div>
      </div>
    </div>
  );
}
