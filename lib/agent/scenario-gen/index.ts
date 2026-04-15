/**
 * Scenario Generator — AI-powered QA scenario creation
 */

import { v4 as uuidv4 } from "uuid";
import { chat, extractJSON } from "@/lib/ai/claude";
import { AGENT_SCENARIO_SYSTEM, buildScenarioGenPrompt } from "@/lib/ai/prompts";
import type { QAScenario, SiteStructure } from "@/lib/ai/types";
import { logger } from "@/lib/logger";

export class ScenarioGenerator {
  async generate(structure: SiteStructure, targetUrl: string, categories?: string[]): Promise<QAScenario[]> {
    logger.info({ url: targetUrl, routes: structure.routes.length, categories }, "Generating scenarios");

    const categoryHint = categories && categories.length > 0
      ? `\n\nFOCUS CATEGORIES: Generate scenarios primarily for these categories: ${categories.join(", ")}. Deprioritize or skip other categories.`
      : "";

    const prompt = buildScenarioGenPrompt(structure) + categoryHint;

    const response = await chat(
      [{ role: "user", content: prompt }],
      AGENT_SCENARIO_SYSTEM,
      { maxTokens: 6000 }
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
      .filter((s) => s.steps.length > 0);

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
    failedScenarios: string[]
  ): Promise<QAScenario[]> {
    const prompt = `These QA scenarios failed: ${failedScenarios.join(", ")}.
Existing scenarios: ${existingScenarios.map((s) => s.name).join(", ")}

Site structure:
${JSON.stringify(structure, null, 2)}

Generate 5 ADDITIONAL edge case scenarios to improve coverage.
Focus on: boundary conditions, empty states, network errors, concurrent actions.
Return a JSON array only.`;

    const response = await chat(
      [{ role: "user", content: prompt }],
      AGENT_SCENARIO_SYSTEM,
      { maxTokens: 3000 }
    );

    try {
      const extras = extractJSON<QAScenario[]>(response);
      return extras.map((s) => ({ ...s, id: s.id ?? `EDGE-${uuidv4().slice(0, 6)}` }));
    } catch {
      return [];
    }
  }
}
