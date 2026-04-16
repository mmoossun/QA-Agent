/**
 * POST /api/human-agent/generate
 * Generate test cases only (no browser execution)
 * Returns structured TestCase[] from GPT-4o
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { openAIClient } from "@/lib/ai/openai";
import { extractJSON } from "@/lib/ai/claude";
import type { TestCase } from "@/lib/google-sheets";

const RequestSchema = z.object({
  targetUrl: z.string().url(),
  goal: z.string().max(1000).optional().default(""),
  categories: z.array(z.string()).optional(),
  customPrompt: z.string().optional(),
  sheetRawTable: z.string().optional(),
  count: z.number().min(1).max(50).default(10),
});

const CATEGORY_DESCRIPTIONS: Record<string, string> = {
  "기능 테스트": "core features work as expected",
  "UI/UX": "layout, responsiveness, visual elements",
  "엣지 케이스": "boundary inputs, empty states, extreme values",
  "보안": "auth, access control, input sanitization",
  "성능": "load time, large data handling",
  "접근성": "keyboard navigation, screen reader, contrast",
  "회귀": "previously working features still work",
};

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = RequestSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { targetUrl, goal, categories, customPrompt, sheetRawTable, count } = parsed.data;

    const categoryLines = (categories ?? [])
      .map((c) => `- ${c}: ${CATEGORY_DESCRIPTIONS[c] ?? c}`)
      .join("\n");

    const sheetSection = sheetRawTable
      ? `\n\nUploaded test sheet (use as reference for additional context):\n${sheetRawTable}`
      : "";

    const customSection = customPrompt
      ? `\n\nAdditional instructions: ${customPrompt}`
      : "";

    const systemPrompt = `You are a senior QA engineer writing test cases for a web application.
Generate exactly ${count} test cases as a JSON array. Each test case must be thorough and actionable.

Return ONLY a raw JSON array (no markdown, no explanation):
[
  {
    "id": "TC-001",
    "category": "category name",
    "title": "short descriptive title",
    "steps": "1. Step one\\n2. Step two\\n3. Step three",
    "expectedResult": "what should happen if the feature works correctly",
    "priority": "High" | "Medium" | "Low",
    "status": "Not Run",
    "notes": ""
  }
]

Priorities:
- High: critical user flows, auth, data integrity
- Medium: important features, common paths
- Low: edge cases, cosmetic issues`;

    const goalLine = goal.trim()
      ? `Testing goal: ${goal}`
      : "Testing goal: Freely explore the web application and identify the most important scenarios to test across all key features.";

    const userPrompt = [
      `Target URL: ${targetUrl}`,
      goalLine,
      categoryLines ? `\nFocus areas:\n${categoryLines}` : "",
      sheetSection,
      customSection,
      `\nGenerate ${count} diverse, specific test cases that cover the most important scenarios.`,
    ].join("\n");

    const response = await openAIClient().chat.completions.create({
      model: "gpt-4o",
      max_tokens: 4000,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });

    const raw = response.choices[0]?.message?.content ?? "[]";
    const testCases = extractJSON<TestCase[]>(raw);

    // Ensure IDs are sequential if model skipped them
    const normalised = testCases.map((tc, i) => ({
      ...tc,
      id: tc.id || `TC-${String(i + 1).padStart(3, "0")}`,
      status: "Not Run" as const,
    }));

    return NextResponse.json({ testCases: normalised });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
