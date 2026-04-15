import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "QA Agent — AI-Powered QA Automation",
  description: "Chat-based and autonomous AI QA system",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body className={inter.className}>
        <div className="min-h-screen flex flex-col">
          <nav className="bg-white border-b border-gray-100 px-6 py-3 flex items-center gap-6">
            <div className="font-bold text-blue-600 text-lg">QA Agent</div>
            <a href="/chat" className="text-sm text-gray-600 hover:text-blue-600 transition-colors">Chat QA</a>
            <a href="/dashboard" className="text-sm text-gray-600 hover:text-blue-600 transition-colors">Dashboard</a>
            <a href="/agent" className="text-sm text-gray-600 hover:text-blue-600 transition-colors">Auto Agent</a>
          </nav>
          <main className="flex-1">{children}</main>
        </div>
      </body>
    </html>
  );
}
