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
        loginUrl: this.config.targetUrl,
      };

      // Step 1: Load main page
      await page.goto(this.config.targetUrl, { waitUntil: "networkidle", timeout: 30_000 });
      structure.title = await page.title();

      // Step 2: Detect SPA
      structure.spa = await this._detectSPA(page);

      // Step 3: Detect auth requirement
      const hasLoginForm = await this._detectAuth(page);
      structure.authRequired = hasLoginForm;

      // Step 4: Collect initial forms & record login URL
      const preAuthForms = await this._collectForms(page);
      structure.forms.push(...preAuthForms);
      structure.loginUrl = page.url();
      structure.routes.push({ path: "/", title: structure.title, hasAuth: false, priority: 10, elements: await this._collectPageElements(page) });

      // Step 5: Login — only if site has a login form AND credentials are provided
      let workspaceId: string | null = null;
      const canLogin = hasLoginForm && !!this.config.loginEmail && !!this.config.loginPassword;
      if (canLogin) {
        const loginResult = await this._login(page, this.config.loginEmail!, this.config.loginPassword!);
        workspaceId = loginResult.workspaceId;
        if (loginResult.postLoginUrl) {
          structure.postLoginUrl = loginResult.postLoginUrl;
          structure.postLoginPattern = this._deriveUrlPattern(loginResult.postLoginUrl);
          logger.info({ postLoginUrl: loginResult.postLoginUrl, pattern: structure.postLoginPattern }, "Logged in, authenticated routes will be explored");
        } else {
          logger.warn("Login may have failed — URL did not change from login page");
        }
      } else if (!hasLoginForm) {
        logger.info("No login form detected — exploring as public/widget site");
        // For sites with no login (e.g. widgets, public pages), record current URL as entry point
        structure.postLoginUrl = page.url();
        structure.postLoginPattern = undefined;
      }

      // Step 6: Discover routes — SPA-aware
      const deadline = Date.now() + (this.config.timeBudgetMs ?? 120_000);
      const visited = new Set<string>();
      visited.add("/");

      if (workspaceId) {
        // SPA with workspace ID pattern (e.g. /w/:id/)
        await this._exploreSPARoutes(page, workspaceId, startUrl.origin, structure, visited, deadline);
      } else {
        // Generic fallback: explore from current page (authenticated or public)
        await this._exploreFromCurrentPage(page, startUrl.origin, structure, visited, deadline);
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

  /** Login and return the post-login URL + any dynamic segment ID from the URL */
  private async _login(
    page: Page, email: string, password: string
  ): Promise<{ workspaceId: string | null; postLoginUrl: string | null }> {
    const loginUrl = page.url();

    const emailSelectors = [
      'input[type="email"]', 'input[name="email"]',
      'input[placeholder*="이메일"]', 'input[placeholder*="email" i]',
    ];
    const pwSelectors = ['input[type="password"]', 'input[name="password"]'];
    const submitSelectors = [
      'button[type="submit"]', 'button:has-text("로그인")',
      'button:has-text("Login")', 'button:has-text("Sign in")',
    ];

    for (const sel of emailSelectors) {
      if ((await page.locator(sel).count()) > 0) { await page.fill(sel, email); break; }
    }
    for (const sel of pwSelectors) {
      if ((await page.locator(sel).count()) > 0) { await page.fill(sel, password); break; }
    }
    for (const sel of submitSelectors) {
      if ((await page.locator(sel).count()) > 0) { await page.click(sel); break; }
    }

    // Wait for URL to change from login page (works for both SPA and MPA)
    try {
      await page.waitForFunction(
        (loginHref: string) => window.location.href !== loginHref,
        loginUrl,
        { timeout: 20_000 }
      );
      await page.waitForTimeout(1500); // let SPA fully render after navigation
    } catch {
      await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => {});
    }

    const currentUrl = page.url();
    logger.info({ from: loginUrl, to: currentUrl }, "Post-login URL captured");

    // If URL didn't change, login likely failed
    if (currentUrl === loginUrl || new URL(currentUrl).pathname === new URL(loginUrl).pathname) {
      logger.warn("Login appears to have failed — URL unchanged");
      return { workspaceId: null, postLoginUrl: null };
    }

    // Extract any dynamic segment ID from URL (e.g. /w/:id/, /workspace/:id/, /app/:id/)
    const idMatch = currentUrl.match(/\/(?:w|workspace|app|org|team|project)\/([^/?#]+)/);
    return {
      workspaceId: idMatch ? idMatch[1] : null,
      postLoginUrl: currentUrl,
    };
  }

  /** Derive a glob pattern from a concrete URL for use in waitForUrl steps */
  private _deriveUrlPattern(url: string): string {
    try {
      const { pathname } = new URL(url);
      // Replace UUID-like or numeric segments with **
      const pattern = pathname
        .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "/**")
        .replace(/\/\d{4,}/g, "/**")
        .replace(/\/[a-zA-Z0-9_-]{20,}/g, "/**"); // long opaque IDs
      // If nothing replaced, just use the first two path segments
      if (!pattern.includes("**")) {
        const parts = pathname.split("/").slice(0, 3);
        return `**${parts.join("/")}/**`;
      }
      return `**${pattern}**`;
    } catch {
      return "**";
    }
  }

  /** Explore routes from the currently loaded (authenticated) page via link collection */
  private async _exploreFromCurrentPage(
    page: Page, origin: string, structure: SiteStructure, visited: Set<string>, deadline: number
  ): Promise<void> {
    const links = await this._collectLinks(page, origin);
    for (const link of links.slice(0, this.config.maxRoutes ?? 20)) {
      if (Date.now() > deadline) break;
      const linkPath = new URL(link).pathname;
      if (visited.has(linkPath)) continue;
      visited.add(linkPath);
      try {
        const routeInfo = await this._visitRoute(page, link);
        if (routeInfo) {
          structure.routes.push(routeInfo);
          structure.forms.push(...await this._collectForms(page));
        }
      } catch (err) {
        logger.debug({ link, err: String(err) }, "Route visit failed");
      }
    }
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
