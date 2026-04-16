import type { Page, Locator, FrameLocator } from "playwright";
import type { SelectorStrategy } from "@/lib/ai/types";
import { logger } from "@/lib/logger";

type PageContext = Page | FrameLocator;

// ─── Build candidate locators from strategy ───────────────────
function buildCandidates(
  ctx: PageContext,
  strategy: SelectorStrategy
): Array<{ name: string; locator: Locator }> {
  const candidates: Array<{ name: string; locator: Locator }> = [];

  if (strategy.testId)
    candidates.push({ name: `testId:${strategy.testId}`, locator: ctx.getByTestId(strategy.testId) });
  if (strategy.ariaLabel)
    candidates.push({ name: `ariaLabel:${strategy.ariaLabel}`, locator: ctx.getByLabel(strategy.ariaLabel) });
  if (strategy.placeholder)
    candidates.push({ name: `placeholder:${strategy.placeholder}`, locator: ctx.locator(`[placeholder="${strategy.placeholder}"]`) });
  if (strategy.role && strategy.text)
    candidates.push({
      name: `role:${strategy.role}+text`,
      locator: ctx.getByRole(strategy.role as Parameters<Page["getByRole"]>[0], { name: strategy.text }),
    });
  if (strategy.text)
    candidates.push({ name: `text:${strategy.text}`, locator: ctx.getByText(strategy.text, { exact: false }) });
  if (strategy.css)
    candidates.push({ name: `css:${strategy.css}`, locator: ctx.locator(strategy.css) });
  if (strategy.xpath)
    candidates.push({ name: `xpath:${strategy.xpath}`, locator: ctx.locator(`xpath=${strategy.xpath}`) });

  return candidates;
}

// ─── Resolve selector — supports Page, FrameLocator, and Shadow DOM ──────────
export async function resolveSelector(
  page: Page,
  strategy: SelectorStrategy,
  timeout = 5000,
  frameSelector?: string
): Promise<Locator> {
  // Determine context: iframe or main page
  const ctx: PageContext = frameSelector ? page.frameLocator(frameSelector) : page;
  const candidates = buildCandidates(ctx, strategy);

  for (const { name, locator } of candidates) {
    try {
      await locator.first().waitFor({ state: "attached", timeout });
      const count = await locator.count();
      if (count > 0) {
        logger.debug({ selector: name, frame: frameSelector ?? "main" }, "Selector resolved");
        return locator.first();
      }
    } catch {
      logger.debug({ selector: name }, "Selector miss, trying next");
    }
  }

  // Shadow DOM fallback — try CSS with pierce: prefix (Playwright pierce selector)
  if (strategy.css && !frameSelector) {
    try {
      const pierced = page.locator(`css=${strategy.css}`);
      await pierced.first().waitFor({ state: "attached", timeout: Math.min(timeout, 2000) });
      if (await pierced.count() > 0) {
        logger.debug({ selector: `pierce:${strategy.css}` }, "Shadow DOM selector resolved");
        return pierced.first();
      }
    } catch { /* ignore */ }
  }

  throw new Error(
    `No selector resolved for strategy: ${JSON.stringify(strategy)}${frameSelector ? ` (frame: ${frameSelector})` : ""}`
  );
}

// ─── Auto-healing: try all strategies, return best match ─────────────────────
export async function findBestLocator(
  page: Page,
  strategy: SelectorStrategy
): Promise<{ locator: Locator; usedStrategy: string } | null> {
  const candidates = buildCandidates(page, strategy);

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
