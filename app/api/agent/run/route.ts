/**
 * POST /api/agent/run
 * Launch autonomous QA agent — streams progress via SSE
 */

import { NextRequest } from "next/server";
import { z } from "zod";
import { AgentRunner, type AgentStatus } from "@/lib/agent/runner";
import { logger } from "@/lib/logger";

const RequestSchema = z.object({
  targetUrl: z.string().url(),
  loginEmail: z.string().email().optional(),
  loginPassword: z.string().optional(),
  maxScenarios: z.number().min(1).max(30).default(15),
  scenarioCategories: z.array(z.string()).optional(),
  customPrompt: z.string().max(2000).optional(),
  directScenarios: z.array(z.any()).optional(),
  scenarioHints: z.array(z.string()).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = RequestSchema.safeParse(body);

    if (!parsed.success) {
      return new Response(JSON.stringify({ error: "Invalid request", details: parsed.error.flatten() }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const { targetUrl, loginEmail, loginPassword, maxScenarios, scenarioCategories, customPrompt, directScenarios, scenarioHints } = parsed.data;

    // Server-Sent Events for real-time progress
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (data: unknown) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        };

        try {
          const agent = new AgentRunner({
            targetUrl,
            loginEmail,
            loginPassword,
            maxScenarios,
            scenarioCategories,
            customPrompt,
            directScenarios: directScenarios as import("@/lib/ai/types").QAScenario[] | undefined,
            scenarioHints,
            onProgress: (status: AgentStatus) => {
              send({ type: "progress", ...status });
            },
          });

          send({ type: "start", message: "Agent started", targetUrl });
          const report = await agent.run();
          send({ type: "complete", report });
        } catch (err) {
          logger.error({ err }, "Agent run error");
          send({ type: "error", message: String(err) });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
