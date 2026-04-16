/**
 * Qwen3-VL Vision — via OpenRouter API (OpenAI-compatible)
 * Role: screenshot → structured UI description (Korean-optimized)
 */

import OpenAI from "openai";

export const QWEN_MODEL = "qwen/qwen3-vl-235b-a22b-instruct";

let _client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!_client) {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set.");
    _client = new OpenAI({
      apiKey,
      baseURL: "https://openrouter.ai/api/v1",
      defaultHeaders: {
        "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
        "X-Title": "QA Agent",
      },
    });
  }
  return _client;
}

const PERCEPTION_SYSTEM = `You are a precise UI analyst. Analyze the screenshot and output a structured description.

Output format (plain text, no markdown):
CURRENT_URL: (if visible in browser bar)
PAGE_TITLE: (page title or heading)
STATE: (loading | form | chat | dashboard | error | success | other)

VISIBLE_TEXT:
- (list every visible text element: labels, headings, buttons, links, messages)

INTERACTIVE_ELEMENTS:
- type: button | input | textarea | select | link | checkbox
  label: (visible text or placeholder)
  selector: (best CSS selector: button, input[type=X], [placeholder="X"], .class, etc.)
  state: enabled | disabled | focused

OBSERVATIONS:
- (any notable UI state, errors, loading spinners, modals, etc.)

Be thorough. Include ALL Korean text accurately. Focus on what a QA tester needs to interact with the UI.`;

/**
 * Qwen3-VL: screenshot → structured UI description
 */
export async function perceiveScreen(
  imageBase64: string,
  currentUrl?: string
): Promise<string> {
  const start = Date.now();

  const response = await getClient().chat.completions.create({
    model: QWEN_MODEL,
    max_tokens: 1024,
    messages: [
      { role: "system", content: PERCEPTION_SYSTEM },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `Analyze this screenshot${currentUrl ? ` (URL: ${currentUrl})` : ""}. Describe all UI elements precisely.`,
          },
          {
            type: "image_url",
            image_url: { url: `data:image/png;base64,${imageBase64}` },
          },
        ],
      },
    ],
  });

  const text = response.choices[0]?.message?.content ?? "";
  console.log(`[Qwen3-VL via OpenRouter] ${Date.now() - start}ms | perception done`);
  return text;
}
