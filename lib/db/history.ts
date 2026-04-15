/**
 * Simple file-based run history store
 * Saves QA run results to data/runs.json for dashboard display
 */

import * as fs from "fs";
import * as path from "path";

const DATA_DIR = path.join(process.cwd(), "data");
const RUNS_FILE = path.join(DATA_DIR, "runs.json");
const MAX_RUNS = 200;

export interface RunRecord {
  id: string;
  mode: "chat" | "quick" | "agent";
  targetUrl: string;
  scenarioCount: number;
  passCount: number;
  failCount: number;
  score: number | null;
  passRate: number;
  duration: number; // ms
  status: "completed" | "failed";
  createdAt: string; // ISO
  summary?: string;
}

function ensureFile(): void {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(RUNS_FILE)) fs.writeFileSync(RUNS_FILE, "[]", "utf-8");
}

export function loadRuns(): RunRecord[] {
  try {
    ensureFile();
    return JSON.parse(fs.readFileSync(RUNS_FILE, "utf-8")) as RunRecord[];
  } catch {
    return [];
  }
}

export function saveRun(record: RunRecord): void {
  try {
    ensureFile();
    const runs = loadRuns();
    runs.unshift(record); // newest first
    if (runs.length > MAX_RUNS) runs.splice(MAX_RUNS);
    fs.writeFileSync(RUNS_FILE, JSON.stringify(runs, null, 2), "utf-8");
  } catch {
    // Non-critical — don't throw
  }
}
