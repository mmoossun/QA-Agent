/**
 * Scenario Generator — AI-powered QA scenario creation
 */

import { v4 as uuidv4 } from "uuid";
import { chat, extractJSON } from "@/lib/ai/claude";
import { AGENT_SCENARIO_SYSTEM, buildScenarioGenPrompt } from "@/lib/ai/prompts";
import type { QAScenario, SiteStructure } from "@/lib/ai/types";
import { logger } from "@/lib/logger";

export class ScenarioGenerator {
  async generate(
    structure: SiteStructure,
    targetUrl: string,
    categories?: string[],
    credentials?: { email?: string; password?: string },
    options?: { customPrompt?: string; scenarioHints?: string[]; sheetRawTable?: string }
  ): Promise<QAScenario[]> {
    logger.info({ url: targetUrl, routes: structure.routes.length, categories }, "Generating scenarios");

    const categoryHint = categories && categories.length > 0
      ? `\n\nFOCUS CATEGORIES: Generate scenarios primarily for these categories: ${categories.join(", ")}. Deprioritize or skip other categories.`
      : "";

    const hintsSection = options?.scenarioHints?.length
      ? `\n\nADDITIONAL TEST CASES TO COVER (from uploaded scenario sheet — generate proper Playwright steps for each):\n${options.scenarioHints.map((h, i) => `${i + 1}. ${h}`).join("\n")}`
      : "";

    const rawTableSection = options?.sheetRawTable
      ? `\n\nUPLOADED TEST SHEET (raw table — analyze all columns freely, infer test cases from any structure):\n${options.sheetRawTable}\n\nInterpret this table however makes sense — column names may be in Korean or English, any format. Extract as many meaningful test scenarios as possible.`
      : "";

    const customSection = options?.customPrompt?.trim()
      ? `\n\nUSER INSTRUCTIONS (follow these specific requirements):\n${options.customPrompt.trim()}`
      : "";

    const prompt = buildScenarioGenPrompt(structure, credentials) + categoryHint + hintsSection + rawTableSection + customSection;

    const response = await chat(
      [{ role: "user", content: prompt }],
      AGENT_SCENARIO_SYSTEM,
      { maxTokens: 8000 }
    );

    let scenarios = extractJSON<QAScenario[]>(response);

    // Validate and fix scenarios
    scenarios = scenarios
      .map((s) => ({
        ...s,
        id: s.id ?? `TC-${uuidv4().slice(0, 6)}`,
        tags: s.tags ?? [],
        preconditions: s.preconditions ?? [],
        steps: s.steps.map((step) => ({
          ...step,
          target: step.target ?? undefined,
        })),
      }))
      .filter((s) => s.steps.length > 0)
      // Reject scenarios with ONLY screenshot/wait steps — they verify nothing
      .filter((s) => s.steps.some((step) => ["assert", "waitForUrl", "evaluate"].includes(step.action)));

    // Sort by priority
    const priorityMap: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };
    scenarios.sort((a, b) => (priorityMap[b.priority] ?? 0) - (priorityMap[a.priority] ?? 0));

    logger.info({ count: scenarios.length }, "Scenarios generated");
    return scenarios;
  }

  // Generate additional edge case scenarios based on failures
  async generateEdgeCases(
    structure: SiteStructure,
    existingScenarios: QAScenario[],
    failedScenarios: string[],
    credentials?: { email?: string; password?: string }
  ): Promise<QAScenario[]> {
    const credNote = credentials?.email
      ? `\nUse these real credentials in scenarios: email="${credentials.email}", password="${credentials.password}".`
      : "";

    const prompt = `These QA scenarios failed: ${failedScenarios.join(", ")}.
Existing scenarios: ${existingScenarios.map((s) => s.name).join(", ")}

Site structure:
${JSON.stringify(structure, null, 2)}
${credNote}

Generate 5 ADDITIONAL edge case scenarios to improve coverage.
Focus on: boundary conditions, empty states, network errors, concurrent actions.
Each scenario MUST include at least one assert or waitForUrl step.
Return a JSON array only.`;

    const response = await chat(
      [{ role: "user", content: prompt }],
      AGENT_SCENARIO_SYSTEM,
      { maxTokens: 4000 }
    );

    try {
      const extras = extractJSON<QAScenario[]>(response);
      return extras
        .map((s) => ({ ...s, id: s.id ?? `EDGE-${uuidv4().slice(0, 6)}` }))
        .filter((s) => s.steps.some((step) => ["assert", "waitForUrl", "evaluate"].includes(step.action)));
    } catch {
      return [];
    }
  }
}
