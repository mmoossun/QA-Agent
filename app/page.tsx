import Link from "next/link";

export default function HomePage() {
  return (
    <div className="max-w-5xl mx-auto px-6 py-16">
      {/* Hero */}
      <div className="text-center mb-16">
        <div className="inline-flex items-center gap-2 bg-blue-50 text-blue-700 text-sm font-medium px-4 py-1.5 rounded-full mb-6">
          <span className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
          AI-Powered QA Automation
        </div>
        <h1 className="text-5xl font-bold text-gray-900 mb-4 leading-tight">
          QA at the Speed of Thought
        </h1>
        <p className="text-xl text-gray-500 max-w-2xl mx-auto mb-8">
          Chat in natural language to generate QA scenarios, or let the autonomous agent explore
          your app and write comprehensive tests automatically.
        </p>
        <div className="flex gap-4 justify-center">
          <Link href="/human-agent" className="btn-primary text-base px-6 py-3">
            Run Auto Agent
          </Link>
          <Link href="/chat" className="btn-secondary text-base px-6 py-3">
            Start Chat QA
          </Link>
        </div>
      </div>

      {/* Features */}
      <div className="grid grid-cols-3 gap-6 mb-16">
        {[
          {
            icon: "💬",
            title: "Chat-Based QA",
            desc: "Type what you want to test. Claude converts it to Playwright scenarios with multi-fallback selectors.",
          },
          {
            icon: "🤖",
            title: "Autonomous Agent",
            desc: "Give a URL + credentials. The agent explores, generates scenarios, runs tests, and produces a full report.",
          },
          {
            icon: "📈",
            title: "Self-Improving Loop",
            desc: "The system evaluates its own quality, identifies gaps, improves code, and commits when score increases.",
          },
        ].map((f) => (
          <div key={f.title} className="card p-6">
            <div className="text-3xl mb-3">{f.icon}</div>
            <h3 className="font-semibold text-gray-900 mb-2">{f.title}</h3>
            <p className="text-sm text-gray-500">{f.desc}</p>
          </div>
        ))}
      </div>

      {/* Score target */}
      <div className="card p-8 text-center bg-gradient-to-br from-blue-50 to-indigo-50 border-blue-100">
        <div className="text-5xl font-bold text-blue-600 mb-2">80</div>
        <div className="text-gray-600 font-medium">Target Quality Score</div>
        <p className="text-sm text-gray-400 mt-2">
          QA Quality (40%) + Execution Reliability (20%) + AI Quality (20%) + Code (10%) + Performance (10%)
        </p>
      </div>
    </div>
  );
}
