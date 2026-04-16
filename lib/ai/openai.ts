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

/**
 * GPT-4o Vision — send screenshot + text, get next action
 * Uses Chat Completions API (supports image inputs)
 */
export async function chatWithVision(
  systemPrompt: string,
  textMessages: { role: "user" | "assistant"; content: string }[],
  imageBase64: string,          // latest screenshot as base64 PNG
  options: { model?: string; maxTokens?: number } = {}
): Promise<string> {
  const { model = "gpt-4o", maxTokens = 1024 } = options;
  const start = Date.now();

  // Build messages: history as text + final user message with image
  const history = textMessages.slice(0, -1).map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));

  const lastText = textMessages[textMessages.length - 1]?.content ?? "";

  const response = await getClient().chat.completions.create({
    model,
    max_tokens: maxTokens,
    messages: [
      { role: "system", content: systemPrompt },
      ...history,
      {
        role: "user",
        content: [
          { type: "text", text: lastText },
          { type: "image_url", image_url: { url: `data:image/png;base64,${imageBase64}`, detail: "high" } },
        ],
      },
    ],
  });

  const text = response.choices[0]?.message?.content ?? "";
  const usage = response.usage;
  console.log(`[GPT-4o Vision] ${model} — ${Date.now() - start}ms | in:${usage?.prompt_tokens ?? "?"} out:${usage?.completion_tokens ?? "?"}`);
  return text;
}

export { getClient as openAIClient };
