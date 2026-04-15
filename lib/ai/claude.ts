import Anthropic from "@anthropic-ai/sdk";
import { logger } from "@/lib/logger";

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

export const MODEL = "claude-opus-4-6";
export const FAST_MODEL = "claude-haiku-4-5-20251001";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

// ─── Core chat completion ─────────────────────────────────────
export async function chat(
  messages: ChatMessage[],
  systemPrompt: string,
  options: {
    model?: string;
    maxTokens?: number;
    temperature?: number;
    useCache?: boolean;
  } = {}
): Promise<string> {
  const {
    model = MODEL,
    maxTokens = 4096,
    useCache = true,
  } = options;

  const start = Date.now();

  try {
    const response = await client.messages.create({
      model,
      max_tokens: maxTokens,
      system: useCache
        ? [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }]
        : systemPrompt,
      messages,
    });

    const text = response.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { type: "text"; text: string }).text)
      .join("");

    logger.debug({ model, duration: Date.now() - start, inputTokens: response.usage.input_tokens }, "Claude response");

    return text;
  } catch (err) {
    logger.error({ err }, "Claude API error");
    throw err;
  }
}

// ─── JSON extraction ─────────────────────────────────────────
export function extractJSON<T>(text: string): T {
  // Try direct parse
  try {
    return JSON.parse(text) as T;
  } catch {
    // Extract from markdown code block
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[1].trim()) as T;
      } catch {
        // continue
      }
    }
    // Last resort: find first { or [
    const start = Math.min(
      text.indexOf("{") === -1 ? Infinity : text.indexOf("{"),
      text.indexOf("[") === -1 ? Infinity : text.indexOf("[")
    );
    const isArr = text.indexOf("[") < text.indexOf("{") || text.indexOf("{") === -1;
    const end = isArr ? text.lastIndexOf("]") + 1 : text.lastIndexOf("}") + 1;
    if (start !== Infinity && end > 0) {
      try {
        return JSON.parse(text.slice(start, end)) as T;
      } catch {
        // fallthrough
      }
    }
    throw new Error(`Cannot extract JSON from: ${text.slice(0, 200)}`);
  }
}

export { client };
