/**
 * Agent Explorer — Autonomous website traversal
 * Discovers: routes, forms, auth requirements, SPA detection
 */

import { chromium, type Page, type Browser } from "playwright";
import type { SiteStructure, RouteInfo, FormInfo } from "@/lib/ai/types";
import { chat, extractJSON } from "@/lib/ai/claude";
import { AGENT_EXPLORER_SYSTEM } from "@/lib/ai/prompts";
import { logger } from "@/lib/logger";

export interface ExplorerConfig {
  targetUrl: string;
  loginEmail?: string;
  loginPassword?: string;
  maxDepth?: number;
  maxRoutes?: number;
  timeBudgetMs?: number;
}

export class SiteExplorer {
  private config: ExplorerConfig;

  constructor(config: ExplorerConfig) {
    this.config = {
      maxDepth: 3,
      maxRoutes: 20,
      timeBudgetMs: 120_000,
      ...config,
    };
  }

  async explore(): Promise<SiteStructure> {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });

    try {
      const page = await context.newPage();
      const startUrl = new URL(this.config.targetUrl);
      const structure: SiteStructure = {
        url: this.config.targetUrl,
        title: "",
        routes: [],
        forms: [],
        authRequired: false,
        spa: false,
        technologies: [],
      };

      // Step 1: Load main page
      await page.goto(this.config.targetUrl, { waitUntil: "networkidle", timeout: 30_000 });
      structure.title = await page.title();

      // Step 2: Detect SPA
      structure.spa = await this._detectSPA(page);

      // Step 3: Detect auth requirement
      structure.authRequired = await this._detectAuth(page);

      // Step 4: Login if credentials provided
      if (this.config.loginEmail && this.config.loginPassword) {
        await this._login(page, this.config.loginEmail, this.config.loginPassword);
      }

      // Step 5: Collect navigation links
      const links = await this._collectLinks(page, startUrl.origin);
      structure.routes.push({ path: "/", title: structure.title, hasAuth: false, priority: 10, elements: [] });

      // Step 6: Visit each discovered route
      const deadline = Date.now() + (this.config.timeBudgetMs ?? 120_000);
      const visited = new Set([this.config.targetUrl]);

      for (const link of links.slice(0, this.config.maxRoutes ?? 20)) {
        if (Date.now() > deadline) {
          logger.warn("Time budget exceeded during exploration");
          break;
        }
        if (visited.has(link)) continue;
        visited.add(link);

        try {
          const routeInfo = await this._visitRoute(page, link, startUrl.origin);
          if (routeInfo) {
            structure.routes.push(routeInfo);
            // Collect forms from this page
            const pageForms = await this._collectForms(page);
            structure.forms.push(...pageForms);
          }
        } catch (err) {
          logger.debug({ link, err: String(err) }, "Route visit failed");
        }
      }

      // Step 7: Collect forms from main page
      const mainForms = await this._collectForms(page);
      structure.forms.push(...mainForms);

      // Step 8: Detect technologies
      structure.technologies = await this._detectTechnologies(page);

      // Step 9: Ask AI to analyze and prioritize
      const aiEnhanced = await this._aiAnalyze(structure);
      return aiEnhanced;
    } finally {
      await context.close();
      await browser.close();
    }
  }

  private async _detectSPA(page: Page): Promise<boolean> {
    return page.evaluate(() => {
      return !!(
        (window as any).__NEXT_DATA__ ||
        (window as any).__nuxt ||
        (window as any).angular ||
        document.querySelector("#root[data-reactroot]") ||
        document.querySelector("#__nuxt") ||
        document.querySelector("script[src*='react']")
      );
    });
  }

  private async _detectAuth(page: Page): Promise<boolean> {
    const url = page.url();
    const hasLoginForm = await page.locator('input[type="password"]').count() > 0;
    const redirectedToLogin = url.includes("login") || url.includes("signin") || url.includes("auth");
    return hasLoginForm || redirectedToLogin;
  }

  private async _login(page: Page, email: string, password: string): Promise<void> {
    // Find login page
    const currentUrl = page.url();
    if (!currentUrl.includes("login") && !currentUrl.includes("signin")) {
      const loginLinks = await page.locator('a[href*="login"], a[href*="signin"], button:has-text("Login"), button:has-text("로그인")').all();
      if (loginLinks.length > 0) {
        await loginLinks[0].click();
        await page.waitForLoadState("networkidle");
      }
    }

    for (const sel of ['input[type="email"]', 'input[name="email"]', 'input[placeholder*="email" i]']) {
      if ((await page.locator(sel).count()) > 0) {
        await page.fill(sel, email);
        break;
      }
    }
    for (const sel of ['input[type="password"]', 'input[name="password"]']) {
      if ((await page.locator(sel).count()) > 0) {
        await page.fill(sel, password);
        break;
      }
    }
    for (const sel of ['button[type="submit"]', 'button:has-text("Login")', 'button:has-text("로그인")']) {
      if ((await page.locator(sel).count()) > 0) {
        await page.click(sel);
        break;
      }
    }
    await page.waitForLoadState("networkidle");
    logger.info({ email }, "Explorer logged in");
  }

  private async _collectLinks(page: Page, origin: string): Promise<string[]> {
    const links = await page.evaluate((orig) => {
      const anchors = Array.from(document.querySelectorAll("a[href]"));
      return anchors
        .map((a) => {
          try {
            return new URL((a as HTMLAnchorElement).href, orig).href;
          } catch {
            return null;
          }
        })
        .filter((href): href is string => {
          if (!href) return false;
          if (!href.startsWith(orig)) return false;
          if (href.includes("#") || href.includes("?")) return false;
          if (/\.(png|jpg|pdf|zip|css|js)$/i.test(href)) return false;
          return true;
        });
    }, origin);
    return [...new Set(links)];
  }

  private async _visitRoute(page: Page, url: string, origin: string): Promise<RouteInfo | null> {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15_000 });
    const path = new URL(url).pathname;
    const title = await page.title();
    const hasPassword = await page.locator('input[type="password"]').count() > 0;
    const elements = await page.evaluate(() => {
      const tags = ["button", "input", "form", "table", "[role='dialog']", "[role='tab']"];
      return tags.filter((t) => document.querySelector(t) !== null);
    });

    // Priority based on path keywords
    let priority = 5;
    if (/login|signin|auth/i.test(path)) priority = 10;
    else if (/dashboard|home/i.test(path)) priority = 9;
    else if (/payment|checkout|billing/i.test(path)) priority = 10;
    else if (/setting|config|admin/i.test(path)) priority = 7;

    return { path, title, hasAuth: hasPassword, priority, elements };
  }

  private async _collectForms(page: Page): Promise<FormInfo[]> {
    return page.evaluate(() => {
      const forms = Array.from(document.querySelectorAll("form"));
      return forms.map((form) => {
        const fields = Array.from(form.querySelectorAll("input, textarea, select"))
          .map((el) => (el as HTMLInputElement).name || (el as HTMLInputElement).placeholder || el.tagName)
          .filter(Boolean);
        const submit = form.querySelector('button[type="submit"], input[type="submit"]');
        return {
          selector: form.id ? `#${form.id}` : `form:nth-of-type(${Array.from(document.querySelectorAll("form")).indexOf(form) + 1})`,
          fields,
          submitSelector: submit ? (submit.id ? `#${submit.id}` : "button[type='submit']") : "",
          purpose: form.getAttribute("data-purpose") ?? fields.join(", ").slice(0, 50),
        };
      });
    });
  }

  private async _detectTechnologies(page: Page): Promise<string[]> {
    return page.evaluate(() => {
      const techs: string[] = [];
      if ((window as any).__NEXT_DATA__) techs.push("Next.js");
      if ((window as any).React) techs.push("React");
      if ((window as any).Vue) techs.push("Vue.js");
      if ((window as any).angular) techs.push("Angular");
      if (document.querySelector('meta[name="generator"][content*="WordPress"]')) techs.push("WordPress");
      return techs;
    });
  }

  private async _aiAnalyze(structure: SiteStructure): Promise<SiteStructure> {
    try {
      const response = await chat(
        [{ role: "user", content: `Analyze this site structure and identify the top 5 user flows by business priority. Also suggest priority scores for each route.\n\n${JSON.stringify(structure, null, 2)}\n\nReturn ONLY the enhanced JSON (same schema, updated priority values).` }],
        AGENT_EXPLORER_SYSTEM
      );
      return extractJSON<SiteStructure>(response);
    } catch {
      logger.warn("AI analysis of site structure failed, using raw structure");
      return structure;
    }
  }
}
