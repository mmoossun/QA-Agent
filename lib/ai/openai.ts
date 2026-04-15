/**
 * OpenAI Responses API provider
 * https://platform.openai.com/docs/api-reference/responses
 */

import OpenAI from "openai";
import * as path from "path";
import * as dotenv from "dotenv";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

export const OAI_MODEL      = "gpt-4o";
export const OAI_FAST_MODEL = "gpt-4o-mini";

let _client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!_client) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey || apiKey === "your-key-here") {
      throw new Error("OPENAI_API_KEY is not set. Add it to your .env file.");
    }
    _client = new OpenAI({ apiKey });
  }
  return _client;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

/**
 * OpenAI Responses API — single/multi-turn chat
 * Docs: POST /v1/responses
 *   input  : string (single turn) | array (multi-turn)
 *   instructions: system prompt
 */
export async function chatOpenAI(
  messages: ChatMessage[],
  systemPrompt: string,
  options: { model?: string; maxTokens?: number } = {}
): Promise<string> {
  const { model = OAI_MODEL, maxTokens = 4096 } = options;
  const start = Date.now();

  // Responses API accepts either a string or an array of message objects
  // For multi-turn we pass the full history as input array
  const input: OpenAI.Responses.EasyInputMessage[] = messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  const response = await getClient().responses.create({
    model,
    instructions: systemPrompt,
    input,
    max_output_tokens: maxTokens,
  });

  // Extract text from output array
  const text = response.output
    .filter((block) => block.type === "message")
    .flatMap((block) =>
      block.type === "message"
        ? block.content.filter((c) => c.type === "output_text").map((c) => (c as { type: "output_text"; text: string }).text)
        : []
    )
    .join("");

  const usage = response.usage;
  console.log(
    `[OpenAI] ${model} — ${Date.now() - start}ms | in:${usage?.input_tokens ?? "?"} out:${usage?.output_tokens ?? "?"}`
  );

  return text;
}

export { getClient as openAIClient };
