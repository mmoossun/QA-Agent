/**
 * File-based report store — data/saved-reports.json
 */

import * as fs from "fs";
import * as path from "path";
import type { TestReport } from "@/lib/human-agent/report-generator";

const DATA_DIR = path.join(process.cwd(), "data");
const FILE = path.join(DATA_DIR, "saved-reports.json");
const MAX = 200;

export interface SavedReport extends TestReport {
  savedAt: string;
  name: string; // user-visible label
}

function ensureFile(): void {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(FILE)) fs.writeFileSync(FILE, "[]", "utf-8");
}

export function loadReports(): SavedReport[] {
  try {
    ensureFile();
    return JSON.parse(fs.readFileSync(FILE, "utf-8")) as SavedReport[];
  } catch { return []; }
}

export function saveReport(report: TestReport, name?: string): SavedReport {
  ensureFile();
  const saved: SavedReport = {
    ...report,
    savedAt: new Date().toISOString(),
    name: name ?? `${new Date().toLocaleDateString("ko-KR")} — ${report.targetUrl}`,
  };
  const list = loadReports();
  // Replace if same id already saved
  const idx = list.findIndex(r => r.id === saved.id);
  if (idx !== -1) list[idx] = saved;
  else list.unshift(saved);
  if (list.length > MAX) list.splice(MAX);
  fs.writeFileSync(FILE, JSON.stringify(list, null, 2), "utf-8");
  return saved;
}

export function deleteReport(id: string): boolean {
  ensureFile();
  const list = loadReports();
  const next = list.filter(r => r.id !== id);
  if (next.length === list.length) return false;
  fs.writeFileSync(FILE, JSON.stringify(next, null, 2), "utf-8");
  return true;
}
