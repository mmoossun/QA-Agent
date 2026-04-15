/**
 * Agent Explorer — Autonomous website traversal
 * Discovers: routes, forms, auth requirements, SPA detection
 */

import { chromium, type Page } from "playwright";
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
      locale: "ko-KR",
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

      // Step 4: Collect pre-auth forms (login form)
      const preAuthForms = await this._collectForms(page);
      structure.forms.push(...preAuthForms);
      structure.routes.push({ path: "/", title: structure.title, hasAuth: false, priority: 10, elements: await this._collectPageElements(page) });

      // Step 5: Login if credentials provided
      let workspaceId: string | null = null;
      if (this.config.loginEmail && this.config.loginPassword) {
        workspaceId = await this._login(page, this.config.loginEmail, this.config.loginPassword);
        logger.info({ workspaceId }, "Explorer logged in, discovering authenticated routes");
      }

      // Step 6: Discover routes — SPA-aware
      const deadline = Date.now() + (this.config.timeBudgetMs ?? 120_000);
      const visited = new Set<string>();
      visited.add("/");

      if (workspaceId) {
        // For ZeroTalk-style SPAs: navigate to known route patterns using the extracted workspaceId
        await this._exploreSPARoutes(page, workspaceId, startUrl.origin, structure, visited, deadline);
      } else {
        // Fallback: collect links from current page and visit them
        const links = await this._collectLinks(page, startUrl.origin);
        for (const link of links.slice(0, this.config.maxRoutes ?? 20)) {
          if (Date.now() > deadline) break;
          const linkPath = new URL(link).pathname;
          if (visited.has(linkPath)) continue;
          visited.add(linkPath);
          try {
            const routeInfo = await this._visitRoute(page, link);
            if (routeInfo) {
              structure.routes.push(routeInfo);
              const pageForms = await this._collectForms(page);
              structure.forms.push(...pageForms);
            }
          } catch (err) {
            logger.debug({ link, err: String(err) }, "Route visit failed");
          }
        }
      }

      // Step 7: Detect technologies
      structure.technologies = await this._detectTechnologies(page);

      // Step 8: Ask AI to analyze and prioritize
      const aiEnhanced = await this._aiAnalyze(structure);
      return aiEnhanced;
    } finally {
      await context.close();
      await browser.close();
    }
  }

  private async _detectSPA(page: Page): Promise<boolean> {
    return page.evaluate(() => {
      const w = window as unknown as Record<string, unknown>;
      return !!(
        w.__NEXT_DATA__ ||
        w.__nuxt ||
        w.angular ||
        document.querySelector("#root") ||
        document.querySelector("#__nuxt") ||
        document.querySelector("script[src*='react']")
      );
    });
  }

  private async _detectAuth(page: Page): Promise<boolean> {
    const url = page.url();
    const hasLoginForm = (await page.locator('input[type="password"]').count()) > 0;
    const redirectedToLogin = url.includes("login") || url.includes("signin") || url.includes("auth");
    return hasLoginForm || redirectedToLogin;
  }

  /** Login and return the workspaceId extracted from the post-login URL (if applicable) */
  private async _login(page: Page, email: string, password: string): Promise<string | null> {
    // ZeroTalk: login is at root, not /login
    const loginSelectors = [
      'input[type="email"]',
      'input[name="email"]',
      'input[placeholder*="이메일"]',
      'input[placeholder*="email" i]',
    ];
    const pwSelectors = ['input[type="password"]', 'input[name="password"]'];
    const submitSelectors = ['button[type="submit"]', 'button:has-text("로그인")', 'button:has-text("Login")'];

    for (const sel of loginSelectors) {
      if ((await page.locator(sel).count()) > 0) {
        await page.fill(sel, email);
        break;
      }
    }
    for (const sel of pwSelectors) {
      if ((await page.locator(sel).count()) > 0) {
        await page.fill(sel, password);
        break;
      }
    }
    for (const sel of submitSelectors) {
      if ((await page.locator(sel).count()) > 0) {
        await page.click(sel);
        break;
      }
    }

    // Wait for SPA navigation after login (URL changes from login page)
    try {
      await page.waitForFunction(
        () => !window.location.pathname.match(/^\/?$/),
        { timeout: 15_000 }
      );
    } catch {
      await page.waitForLoadState("networkidle");
    }

    const currentUrl = page.url();
    logger.info({ url: currentUrl }, "Post-login URL");

    // Extract workspaceId for ZeroTalk-style SPAs: /w/:workspaceId/...
    const match = currentUrl.match(/\/w\/([^/?#]+)/);
    return match ? match[1] : null;
  }

  /** Navigate through known SPA route patterns using the workspaceId */
  private async _exploreSPARoutes(
    page: Page,
    workspaceId: string,
    origin: string,
    structure: SiteStructure,
    visited: Set<string>,
    deadline: number
  ): Promise<void> {
    const knownRouteTemplates = [
      `/w/${workspaceId}`,
      `/w/${workspaceId}/conversations`,
      `/w/${workspaceId}/settings`,
      `/w/${workspaceId}/settings/team`,
      `/w/${workspaceId}/settings/profile`,
      `/w/${workspaceId}/settings/notifications`,
      `/w/${workspaceId}/settings/workspace`,
      `/w/${workspaceId}/settings/integrations`,
    ];

    for (const routePath of knownRouteTemplates) {
      if (Date.now() > deadline) break;
      if (visited.has(routePath)) continue;
      visited.add(routePath);

      const fullUrl = `${origin}${routePath}`;
      try {
        await page.goto(fullUrl, { waitUntil: "domcontentloaded", timeout: 15_000 });
        await page.waitForTimeout(800); // allow SPA render

        const title = await page.title();
        const elements = await this._collectPageElements(page);
        const forms = await this._collectForms(page);

        let priority = 5;
        if (routePath.includes("settings/team")) priority = 8;
        else if (routePath.includes("settings")) priority = 7;
        else if (routePath.includes("conversations")) priority = 9;
        else if (routePath === `/w/${workspaceId}`) priority = 9;

        structure.routes.push({ path: routePath, title, hasAuth: true, priority, elements });
        if (forms.length > 0) structure.forms.push(...forms);

        logger.debug({ path: routePath, elements: elements.length }, "Explored route");
      } catch (err) {
        logger.debug({ routePath, err: String(err) }, "SPA route visit failed");
      }
    }

    // Also collect any dynamic links from the current page
    try {
      const links = await this._collectLinks(page, origin);
      const newLinks = links.filter((l) => {
        const p = new URL(l).pathname;
        return !visited.has(p) && p.includes(workspaceId);
      });
      for (const link of newLinks.slice(0, 5)) {
        if (Date.now() > deadline) break;
        const p = new URL(link).pathname;
        visited.add(p);
        try {
          await page.goto(link, { waitUntil: "domcontentloaded", timeout: 10_000 });
          await page.waitForTimeout(500);
          const title = await page.title();
          const elements = await this._collectPageElements(page);
          structure.routes.push({ path: p, title, hasAuth: true, priority: 5, elements });
        } catch {/* skip */}
      }
    } catch {/* skip */}
  }

  private async _collectLinks(page: Page, origin: string): Promise<string[]> {
    const links = await page.evaluate((orig) => {
      const anchors = Array.from(document.querySelectorAll("a[href]"));
      return anchors
        .map((a) => {
          try { return new URL((a as HTMLAnchorElement).href, orig).href; } catch { return null; }
        })
        .filter((href): href is string => {
          if (!href) return false;
          if (!href.startsWith(orig)) return false;
          if (href.includes("#") || href.includes("?")) return false;
          if (/\.(png|jpg|pdf|zip|css|js)$/i.test(href)) return false;
          return true;
        });
    }, origin);
    return Array.from(new Set(links));
  }

  private async _visitRoute(page: Page, url: string): Promise<RouteInfo | null> {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15_000 });
    const p = new URL(url).pathname;
    const title = await page.title();
    const hasPassword = (await page.locator('input[type="password"]').count()) > 0;
    const elements = await this._collectPageElements(page);

    let priority = 5;
    if (/login|signin|auth/i.test(p)) priority = 10;
    else if (/dashboard|home/i.test(p)) priority = 9;
    else if (/setting|config|admin/i.test(p)) priority = 7;

    return { path: p, title, hasAuth: hasPassword, priority, elements };
  }

  private async _collectPageElements(page: Page): Promise<string[]> {
    return page.evaluate(() => {
      const tags = ["button", "input", "form", "table", "[role='dialog']", "[role='tab']", "[role='menu']", "textarea", "select"];
      return tags.filter((t) => document.querySelector(t) !== null);
    });
  }

  private async _collectForms(page: Page): Promise<FormInfo[]> {
    return page.evaluate(() => {
      const forms = Array.from(document.querySelectorAll("form"));
      return forms.map((form, idx) => {
        // Return actual usable CSS selectors, not field names/placeholders as plain text
        const fields = Array.from(form.querySelectorAll("input, textarea, select"))
          .map((el) => {
            const e = el as HTMLInputElement;
            if (e.type === "email") return `input[type="email"]`;
            if (e.type === "password") return `input[type="password"]`;
            if (e.type === "text" && e.placeholder) return `input[placeholder="${e.placeholder}"]`;
            if (e.placeholder) return `[placeholder="${e.placeholder}"]`;
            if (e.name) return `input[name="${e.name}"]`;
            return el.tagName.toLowerCase();
          })
          .filter(Boolean);
        const submit = form.querySelector('button[type="submit"], input[type="submit"]');
        const submitSel = submit
          ? (submit.id ? `#${submit.id}` : `button[type="submit"]`)
          : "";
        return {
          selector: form.id ? `#${form.id}` : `form:nth-of-type(${idx + 1})`,
          fields,
          submitSelector: submitSel,
          purpose: `Form with: ${fields.join(", ").slice(0, 80)}`,
        };
      });
    });
  }

  private async _detectTechnologies(page: Page): Promise<string[]> {
    return page.evaluate(() => {
      const w = window as unknown as Record<string, unknown>;
      const techs: string[] = [];
      if (w.__NEXT_DATA__) techs.push("Next.js");
      if (w.React) techs.push("React");
      if (w.Vue) techs.push("Vue.js");
      if (w.ZeroTalk) techs.push("ZeroTalk Widget");
      if (document.querySelector('meta[name="generator"][content*="WordPress"]')) techs.push("WordPress");
      if (document.querySelector("#root") && !w.__NEXT_DATA__) techs.push("React Router SPA");
      return techs;
    });
  }

  private async _aiAnalyze(structure: SiteStructure): Promise<SiteStructure> {
    try {
      const response = await chat(
        [{
          role: "user",
          content: `Analyze this site structure and identify the top 5 user flows by business priority. Update priority scores for each route.\n\n${JSON.stringify(structure, null, 2)}\n\nReturn ONLY the enhanced JSON (same schema, updated priority values and topUserFlows array).`,
        }],
        AGENT_EXPLORER_SYSTEM
      );
      return extractJSON<SiteStructure>(response);
    } catch {
      logger.warn("AI analysis of site structure failed, using raw structure");
      return structure;
    }
  }
}
