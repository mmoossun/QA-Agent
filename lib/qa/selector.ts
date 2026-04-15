import type { Page, Locator } from "playwright";
import type { SelectorStrategy } from "@/lib/ai/types";
import { logger } from "@/lib/logger";

// ─── Selector priority: testId → ariaLabel → role → text → css → xpath ──────

export async function resolveSelector(
  page: Page,
  strategy: SelectorStrategy,
  timeout = 5000
): Promise<Locator> {
  const candidates: Array<{ name: string; locator: Locator }> = [];

  if (strategy.testId) {
    candidates.push({ name: `testId:${strategy.testId}`, locator: page.getByTestId(strategy.testId) });
  }
  if (strategy.ariaLabel) {
    candidates.push({ name: `ariaLabel:${strategy.ariaLabel}`, locator: page.getByLabel(strategy.ariaLabel) });
  }
  if (strategy.role && strategy.text) {
    candidates.push({
      name: `role:${strategy.role}+text`,
      locator: page.getByRole(strategy.role as Parameters<Page["getByRole"]>[0], { name: strategy.text }),
    });
  }
  if (strategy.text) {
    candidates.push({ name: `text:${strategy.text}`, locator: page.getByText(strategy.text, { exact: false }) });
  }
  if (strategy.css) {
    candidates.push({ name: `css:${strategy.css}`, locator: page.locator(strategy.css) });
  }
  if (strategy.xpath) {
    candidates.push({ name: `xpath:${strategy.xpath}`, locator: page.locator(`xpath=${strategy.xpath}`) });
  }

  for (const { name, locator } of candidates) {
    try {
      await locator.first().waitFor({ state: "attached", timeout });
      const count = await locator.count();
      if (count > 0) {
        logger.debug({ selector: name, count }, "Selector resolved");
        return locator.first();
      }
    } catch {
      logger.debug({ selector: name }, "Selector miss, trying next");
    }
  }

  throw new Error(
    `No selector resolved for strategy: ${JSON.stringify(strategy)}`
  );
}

// ─── Auto-healing: try all strategies, return best match ──────────────────────
export async function findBestLocator(
  page: Page,
  strategy: SelectorStrategy
): Promise<{ locator: Locator; usedStrategy: string } | null> {
  const candidates = [
    strategy.testId ? { name: "testId", locator: page.getByTestId(strategy.testId) } : null,
    strategy.ariaLabel ? { name: "ariaLabel", locator: page.getByLabel(strategy.ariaLabel) } : null,
    strategy.text ? { name: "text", locator: page.getByText(strategy.text, { exact: false }) } : null,
    strategy.css ? { name: "css", locator: page.locator(strategy.css) } : null,
    strategy.xpath ? { name: "xpath", locator: page.locator(`xpath=${strategy.xpath}`) } : null,
  ].filter(Boolean) as { name: string; locator: Locator }[];

  for (const { name, locator } of candidates) {
    try {
      const count = await locator.count();
      if (count > 0) return { locator: locator.first(), usedStrategy: name };
    } catch {
      // continue
    }
  }
  return null;
}
