/**
 * POST /api/chat
 * Natural language → QA scenarios → (optional) run → results
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { chat, extractJSON } from "@/lib/ai/claude";
import { buildChatQAPrompt, CHAT_QA_SYSTEM } from "@/lib/ai/prompts";
import type { QAScenario } from "@/lib/ai/types";
import { logger } from "@/lib/logger";

const RequestSchema = z.object({
  message: z.string().min(1).max(2000),
  projectId: z.string().optional(),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() }))
    .default([]),
  executeNow: z.boolean().default(false),
  targetUrl: z.string().url().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = RequestSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
    }

    const { message, history, executeNow, targetUrl } = parsed.data;

    logger.info({ message: message.slice(0, 80), executeNow }, "Chat request");

    // Build conversation messages
    const messages: { role: "user" | "assistant"; content: string }[] = [
      ...history,
      { role: "user", content: buildChatQAPrompt(message) },
    ];

    // Get scenarios from Claude
    const aiResponse = await chat(messages, CHAT_QA_SYSTEM, { maxTokens: 4000, useCache: true });

    let scenarios: QAScenario[] = [];
    let parseError: string | undefined;

    try {
      scenarios = extractJSON<QAScenario[]>(aiResponse);
      if (!Array.isArray(scenarios)) scenarios = [scenarios as unknown as QAScenario];
    } catch (err) {
      parseError = String(err);
      logger.warn({ err: parseError }, "Failed to parse scenarios, returning raw response");
    }

    // Execute if requested and URL provided
    let results = null;
    if (executeNow && targetUrl && scenarios.length > 0) {
      const { QARunner } = await import("@/lib/qa/runner");
      const runner = new QARunner({ baseUrl: targetUrl });
      await runner.init();
      try {
        results = await runner.runAll(scenarios);
      } finally {
        await runner.close();
      }
    }

    return NextResponse.json({
      success: true,
      scenarios,
      results,
      rawResponse: parseError ? aiResponse : undefined,
      message: parseError
        ? "Could not parse scenarios — showing raw AI response"
        : `Generated ${scenarios.length} test scenario(s)`,
    });
  } catch (err) {
    logger.error({ err }, "Chat API error");
    return NextResponse.json({ error: "Internal server error", detail: String(err) }, { status: 500 });
  }
}
