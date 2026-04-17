/**
 * File-based test memory store with embeddings
 * Saves completed runs to data/test-memory.json for similarity search
 */

import * as fs from "fs";
import * as path from "path";
import { createEmbedding, cosineSimilarity } from "./embeddings";
import type { HumanAgentResult } from "@/lib/human-agent/runner";

const DATA_DIR = path.join(process.cwd(), "data");
const MEMORY_FILE = path.join(DATA_DIR, "test-memory.json");
const MAX_RECORDS = 500;

export interface FailedStepSummary {
  stepNumber: number;
  action: string;
  description: string;
  error: string;
}

export interface TestMemoryRecord {
  id: string;
  createdAt: string;
  targetUrl: string;
  goal: string;
  status: "done" | "fail" | "max_steps";
  summary: string;
  passRate: number;
  totalDurationMs: number;
  stepCount: number;
  failedSteps: FailedStepSummary[];
  embedding: number[];
}

function load(): TestMemoryRecord[] {
  try {
    if (!fs.existsSync(MEMORY_FILE)) return [];
    return JSON.parse(fs.readFileSync(MEMORY_FILE, "utf-8")) as TestMemoryRecord[];
  } catch { return []; }
}

function persist(records: TestMemoryRecord[]): void {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(MEMORY_FILE, JSON.stringify(records, null, 2), "utf-8");
}

function buildEmbedText(result: HumanAgentResult, failedSteps: FailedStepSummary[]): string {
  return [
    `URL: ${result.targetUrl}`,
    `Goal: ${result.goal}`,
    `Status: ${result.status}`,
    `Summary: ${result.summary}`,
    failedSteps.length > 0
      ? `Failed steps: ${failedSteps.map(s => `[${s.action}] ${s.description}: ${s.error}`).join("; ")}`
      : "All steps passed",
  ].join("\n");
}

export async function saveTestMemory(result: HumanAgentResult): Promise<void> {
  const passCount = result.steps.filter(s => s.success).length;
  const failedSteps: FailedStepSummary[] = result.steps
    .filter(s => !s.success)
    .map(s => ({
      stepNumber: s.stepNumber,
      action: s.decision.action,
      description: s.decision.description,
      error: s.error ?? "",
    }));

  const embedding = await createEmbedding(buildEmbedText(result, failedSteps));

  const record: TestMemoryRecord = {
    id: result.sessionId,
    createdAt: new Date().toISOString(),
    targetUrl: result.targetUrl,
    goal: result.goal,
    status: result.status,
    summary: result.summary,
    passRate: result.steps.length > 0 ? (passCount / result.steps.length) * 100 : 0,
    totalDurationMs: result.totalDurationMs,
    stepCount: result.steps.length,
    failedSteps,
    embedding,
  };

  const records = load();
  records.unshift(record);
  if (records.length > MAX_RECORDS) records.splice(MAX_RECORDS);
  persist(records);
}

export async function searchSimilarTests(
  query: string,
  topK = 3,
  minSimilarity = 0.65,
): Promise<Array<TestMemoryRecord & { similarity: number }>> {
  const records = load();
  if (records.length === 0) return [];

  const queryEmbedding = await createEmbedding(query);

  return records
    .map(r => ({ ...r, similarity: cosineSimilarity(queryEmbedding, r.embedding) }))
    .filter(r => r.similarity >= minSimilarity)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, topK);
}

export function loadAllTests(limit = 100): TestMemoryRecord[] {
  return load().slice(0, limit);
}
