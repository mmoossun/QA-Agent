import Anthropic from "@anthropic-ai/sdk";
import * as path from "path";
import * as dotenv from "dotenv";
import { chatOpenAI, OAI_MODEL, OAI_FAST_MODEL } from "@/lib/ai/openai";

// Load .env at module level — works whether called from Next.js or tsx scripts
dotenv.config({ path: path.resolve(process.cwd(), ".env") });

export const MODEL = "claude-opus-4-6";
export const FAST_MODEL = "claude-haiku-4-5-20251001";

/** Returns the active provider: "claude" | "openai" */
export function getProvider(): "claude" | "openai" {
  const p = (process.env.AI_PROVIDER ?? "claude").toLowerCase();
  return p === "openai" ? "openai" : "claude";
}

// Lazy client — created on first use so env vars are always resolved
let _client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!_client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey || apiKey === "your-key-here") {
      throw new Error(
        "ANTHROPIC_API_KEY is not set. Add it to your .env file."
      );
    }
    _client = new Anthropic({ apiKey });
  }
  return _client;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

// ─── Core chat completion ──────────────────────────────────────
// Routes to Claude or OpenAI based on AI_PROVIDER env var
export async function chat(
  messages: ChatMessage[],
  systemPrompt: string,
  options: {
    model?: string;
    maxTokens?: number;
    useCache?: boolean;
  } = {}
): Promise<string> {
  const provider = getProvider();

  if (provider === "openai") {
    // Map fast/slow model hints to OpenAI equivalents
    let oaiModel = OAI_MODEL;
    if (options.model === FAST_MODEL) oaiModel = OAI_FAST_MODEL;
    return chatOpenAI(messages, systemPrompt, {
      model: oaiModel,
      maxTokens: options.maxTokens,
    });
  }

  // ── Claude path ──
  const { model = MODEL, maxTokens = 4096, useCache = true } = options;
  const start = Date.now();

  const response = await getClient().messages.create({
    model,
    max_tokens: maxTokens,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    system: (useCache
      ? [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }]
      : systemPrompt) as any,
    messages,
  });

  const text = response.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { type: "text"; text: string }).text)
    .join("");

  console.log(`[Claude] ${model} — ${Date.now() - start}ms | in:${response.usage.input_tokens} out:${response.usage.output_tokens}`);
  return text;
}

// ─── JSON extraction ──────────────────────────────────────────
export function extractJSON<T>(text: string): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    const blockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (blockMatch) {
      try { return JSON.parse(blockMatch[1].trim()) as T; } catch { /* continue */ }
    }
    const objStart = text.indexOf("{");
    const arrStart = text.indexOf("[");
    const useArr = arrStart !== -1 && (objStart === -1 || arrStart < objStart);
    const start = useArr ? arrStart : objStart;
    const end = useArr ? text.lastIndexOf("]") + 1 : text.lastIndexOf("}") + 1;
    if (start !== -1 && end > 0) {
      try { return JSON.parse(text.slice(start, end)) as T; } catch { /* fallthrough */ }
    }
    throw new Error(`Cannot extract JSON from response: ${text.slice(0, 200)}`);
  }
}

export { getClient as client };
