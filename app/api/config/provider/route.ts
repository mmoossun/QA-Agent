/**
 * GET  /api/config/provider  — returns current active AI provider
 * POST /api/config/provider  — switches AI_PROVIDER at runtime (writes to .env)
 */

import { NextRequest } from "next/server";
import * as fs from "fs";
import * as path from "path";

const ENV_PATH = path.resolve(process.cwd(), ".env");

function readEnv(): Record<string, string> {
  if (!fs.existsSync(ENV_PATH)) return {};
  const lines = fs.readFileSync(ENV_PATH, "utf-8").split("\n");
  const map: Record<string, string> = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    map[trimmed.slice(0, idx)] = trimmed.slice(idx + 1);
  }
  return map;
}

function writeEnvKey(key: string, value: string): void {
  if (!fs.existsSync(ENV_PATH)) {
    fs.writeFileSync(ENV_PATH, `${key}=${value}\n`, "utf-8");
    return;
  }
  const content = fs.readFileSync(ENV_PATH, "utf-8");
  const regex = new RegExp(`^${key}=.*$`, "m");
  if (regex.test(content)) {
    fs.writeFileSync(ENV_PATH, content.replace(regex, `${key}=${value}`), "utf-8");
  } else {
    fs.writeFileSync(ENV_PATH, content.trimEnd() + `\n${key}=${value}\n`, "utf-8");
  }
}

export async function GET() {
  const env = readEnv();
  const provider = (env["AI_PROVIDER"] ?? "openai").toLowerCase();
  const active = provider === "openai" ? "openai" : "claude";
  const hasOpenAI = !!(env["OPENAI_API_KEY"] && env["OPENAI_API_KEY"] !== "your-key-here");
  const hasClaude = !!(env["ANTHROPIC_API_KEY"] && env["ANTHROPIC_API_KEY"] !== "your-key-here");
  return Response.json({ provider: active, hasOpenAI, hasClaude });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const provider = body.provider;
    if (provider !== "claude" && provider !== "openai") {
      return Response.json({ error: "provider must be 'claude' or 'openai'" }, { status: 400 });
    }

    writeEnvKey("AI_PROVIDER", provider);
    // Update process.env immediately so current process picks it up without restart
    process.env.AI_PROVIDER = provider;

    return Response.json({ ok: true, provider });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
