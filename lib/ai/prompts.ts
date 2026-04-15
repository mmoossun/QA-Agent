import type { SiteStructure } from "./types";

// ─── System Prompts ───────────────────────────────────────────

export const CHAT_QA_SYSTEM = `You are an expert QA automation engineer with 10+ years of experience.
Your role is to:
1. Parse user natural language requests into structured QA test scenarios
2. Generate Playwright-compatible test steps with robust selector strategies
3. Prioritize test flows by business impact (auth > payment > forms > navigation)
4. Always include happy path AND edge cases

Selector priority (ALWAYS follow this order):
1. data-testid attribute (most reliable)
2. aria-label / role
3. visible text content
4. CSS class (avoid fragile ones)
5. XPath (last resort only)

Output ONLY valid JSON. No explanations outside the JSON block.`;

export const AGENT_EXPLORER_SYSTEM = `You are a web crawler and site structure analyzer.
Analyze screenshots and DOM information to understand:
- Page routes and navigation structure
- Authentication requirements
- Forms and interactive elements
- SPA vs MPA behavior
- Business-critical user flows

Identify the TOP 5 most important user flows to test based on business impact.
Output structured JSON only.`;

export const AGENT_SCENARIO_SYSTEM = `You are a QA scenario architect specializing in Playwright test automation.
Given a site structure, generate comprehensive test scenarios covering:
- Happy path (primary user journey)
- Edge cases (boundary conditions, invalid inputs)
- Security (XSS attempts, auth bypass)
- UI consistency and error handling

CRITICAL RULES — violating these makes a scenario worthless:
1. NEVER use placeholder credentials like "user@example.com" or "ValidPassword123". Use ONLY the real credentials provided in the prompt.
2. Every auth scenario MUST include a "waitForUrl" step (timeout: 25000) after login submit to verify the redirect actually happened.
3. Every scenario MUST include at least TWO verification steps (assert or waitForUrl). Screenshot-only or single-step scenarios are FORBIDDEN.
4. All "waitForUrl" steps MUST have timeout: 25000. All "assert" steps MUST have timeout: 15000.
5. For error scenarios (wrong password, empty fields): add "wait" 2000ms then assert the error element OR login form is still visible.
6. After every page navigation or SPA route change, add "wait" at least 2000ms before asserting to allow SPA rendering.
7. Available actions: navigate, click, fill, assert, wait, screenshot, scroll, hover, press, evaluate, waitForUrl.
8. "waitForUrl" value must be a glob pattern like "**/dashboard**" or the full URL pattern.

SELECTOR RULES — wrong selectors cause 100% failure rate:
- Email inputs: ALWAYS use css "input[type='email']"
- Password inputs: ALWAYS use css "input[type='password']"
- Submit buttons: ALWAYS use css "button[type='submit']"
- If the site structure lists a field as 'input[placeholder="X"]', use that EXACT string as the css selector
- NEVER invent input[name='non-english text'] — non-English field labels are the placeholder, not the name attribute
- Failed login verification: assert css "input[type='password']" is still visible (= still on login page = login failed)
- UNIVERSAL PAGE-LOADED CHECK: assert css "body" with timeout 15000 — "body" ALWAYS exists on any HTML page, use this as the guaranteed page-loaded assertion
- "main" may NOT exist in SPAs — NEVER use "main" as a selector. Use "body" instead.
- Other safe selectors (if the site structure shows they exist): "nav", "header", "h1"

SPA HANDLING:
- For SPAs (React, Vue, Next.js): always use waitForUrl with "commit" timing, not "load"
- If navigating to a dynamic URL that includes IDs: use evaluate to extract the current ID from window.location then construct the target URL
- Add wait: 2000 after any evaluate that changes window.location.href
- Use "assert" with target css "body" as a basic page-loaded check (NEVER use "main" — it may not exist)

SECURITY SCENARIO RULES:
- Unauthorized access scenarios: navigate to protected route WITHOUT login → add wait 3000 → assert css "body" → take screenshot (documents what the app shows for unauthorized access; do NOT assert input[type='email'] since the app may not redirect to login)
- XSS scenarios: only generate if the site structure shows forms with text inputs. Fill the input with XSS payload → assert css "body" → screenshot. Do NOT assert alerts or popups.
- If the site has NO login form (public/widget site), do NOT generate auth or security scenarios — generate UI and navigation scenarios only.

Output ONLY valid JSON array. No explanations.`;

export const EVALUATOR_SYSTEM = `You are a QA quality evaluator.
Analyze test execution results and score the QA system across these dimensions:
- QA Quality (40%): scenario coverage, edge cases, selector quality
- Execution Reliability (20%): retry logic, flaky test detection, timeout handling
- AI Quality (20%): prompt effectiveness, JSON accuracy, scenario relevance
- Code Quality (10%): TypeScript usage, error handling, modularity
- Performance (10%): execution speed, parallelism, resource usage

Provide specific, actionable improvements for the lowest-scoring dimensions.`;

// ─── Few-shot Prompt Builders ─────────────────────────────────

export function buildChatQAPrompt(userInput: string): string {
  return `Convert this user request into QA test scenarios.

## Examples

### Input: "Test login with valid and invalid credentials"
### Output:
\`\`\`json
[
  {
    "id": "AUTH-001",
    "name": "Login with valid credentials",
    "category": "auth",
    "priority": "critical",
    "preconditions": ["User is on login page", "Account exists"],
    "steps": [
      {
        "action": "navigate",
        "value": "/login",
        "description": "Go to login page"
      },
      {
        "action": "fill",
        "target": {
          "testId": "email-input",
          "ariaLabel": "Email address",
          "css": "input[type='email']"
        },
        "value": "test@example.com",
        "description": "Enter valid email"
      },
      {
        "action": "fill",
        "target": {
          "testId": "password-input",
          "ariaLabel": "Password",
          "css": "input[type='password']"
        },
        "value": "ValidPass123",
        "description": "Enter valid password"
      },
      {
        "action": "click",
        "target": {
          "testId": "login-button",
          "ariaLabel": "Sign in",
          "text": "Login",
          "css": "button[type='submit']"
        },
        "description": "Click login button"
      },
      {
        "action": "assert",
        "target": { "testId": "dashboard-header", "css": "[data-page='dashboard']" },
        "description": "Verify dashboard loaded"
      },
      {
        "action": "screenshot",
        "description": "Capture successful login state"
      }
    ],
    "expectedResult": "User is redirected to dashboard with welcome message",
    "tags": ["smoke", "auth", "critical-path"]
  },
  {
    "id": "AUTH-002",
    "name": "Login with invalid password shows error",
    "category": "auth",
    "priority": "high",
    "preconditions": ["User is on login page"],
    "steps": [
      {
        "action": "navigate",
        "value": "/login",
        "description": "Go to login page"
      },
      {
        "action": "fill",
        "target": { "testId": "email-input", "css": "input[type='email']" },
        "value": "test@example.com",
        "description": "Enter valid email"
      },
      {
        "action": "fill",
        "target": { "testId": "password-input", "css": "input[type='password']" },
        "value": "WrongPassword",
        "description": "Enter wrong password"
      },
      {
        "action": "click",
        "target": { "testId": "login-button", "css": "button[type='submit']" },
        "description": "Click login"
      },
      {
        "action": "assert",
        "target": { "testId": "error-message", "css": "[role='alert']", "text": "Invalid" },
        "description": "Verify error message appears"
      }
    ],
    "expectedResult": "Error message shown, user stays on login page",
    "tags": ["auth", "negative-test"]
  }
]
\`\`\`

### Input: "Check that the chat widget opens and sends a message"
### Output:
\`\`\`json
[
  {
    "id": "CHAT-001",
    "name": "Open chat widget and send message",
    "category": "ui",
    "priority": "high",
    "preconditions": ["Widget is embedded on page"],
    "steps": [
      {
        "action": "click",
        "target": {
          "testId": "chat-widget-button",
          "ariaLabel": "Open chat",
          "css": "[class*='chat-button'], [class*='widget-button']"
        },
        "description": "Click chat widget button"
      },
      {
        "action": "assert",
        "target": { "testId": "chat-window", "css": "[class*='chat-window']" },
        "description": "Verify chat window opened"
      },
      {
        "action": "fill",
        "target": { "testId": "message-input", "ariaLabel": "Type a message", "css": "textarea, input[placeholder*='message']" },
        "value": "Hello, I need help",
        "description": "Type a message"
      },
      {
        "action": "click",
        "target": { "testId": "send-button", "ariaLabel": "Send", "text": "Send", "css": "button[type='submit']" },
        "description": "Send message"
      },
      {
        "action": "assert",
        "target": { "css": "[class*='message'][class*='user']", "text": "Hello, I need help" },
        "description": "Verify message appears in chat"
      },
      {
        "action": "screenshot",
        "description": "Capture chat with sent message"
      }
    ],
    "expectedResult": "Message sent and visible in chat window",
    "tags": ["chat", "widget", "smoke"]
  }
]
\`\`\`

---

## Now convert this request:
"${userInput}"

Return ONLY a JSON array of QAScenario objects. No additional text.`;
}

export function buildScenarioGenPrompt(
  structure: SiteStructure,
  credentials?: { email?: string; password?: string }
): string {
  const credSection = credentials?.email
    ? `\nREAL CREDENTIALS (use these exactly — do NOT substitute placeholders):
  email: "${credentials.email}"
  password: "${credentials.password}"\n`
    : "";

  const loginContext = structure.postLoginUrl
    ? `\nURL CONTEXT (critical for waitForUrl patterns):
  Login URL: ${structure.loginUrl ?? structure.url}
  Post-login URL (actual): ${structure.postLoginUrl}
  Post-login glob pattern: ${structure.postLoginPattern ?? `**${new URL(structure.postLoginUrl).pathname.split("/").slice(0, 3).join("/")}/**`}
  → Use this EXACT glob pattern for all "waitForUrl" steps after login\n`
    : "";

  return `Generate comprehensive QA test scenarios for this site.
${credSection}${loginContext}
Site Analysis:
${JSON.stringify(structure, null, 2)}

Requirements:
1. Cover ALL discovered routes and forms
2. Test auth flows FIRST (highest priority)
3. Include happy path + at least 2 edge cases per critical flow
4. Use multi-fallback selectors: testId > ariaLabel > text > css
5. After every login submit: add a "waitForUrl" step (timeout: 25000) to confirm redirect
6. For failed login tests: add wait:2000 then assert login form still visible (css: "input[type='password']")
7. Mark auth/payment flows as "critical" priority
8. Generate 12-15 scenarios total
9. Every scenario MUST contain at least TWO verification steps (assert or waitForUrl)
10. All waitForUrl timeout: 25000. All assert timeout: 15000
11. After any navigation that changes the URL (navigate, evaluate with location.href), add wait:2000
12. Include negative tests (invalid input, empty fields) tagged "negative-test"
13. For security: generate at most ONE scenario — navigate to protected route without login → wait 3000 → assert css "body" → screenshot

FORM FILL RULES (critical — prevents selector failures):
- ONLY generate "fill" steps for form fields that EXPLICITLY appear in the site structure's "forms[].fields" array
- If a route has NO associated form in the site structure, do NOT invent fill steps for that route
- For pages like settings/profile where a form may exist but wasn't captured: use assert + screenshot to verify the page loaded — do NOT guess field selectors
- SAFE PAGE-LOADED ASSERTION: assert css "body" (timeout: 15000) — "body" is GUARANTEED to exist on every HTML page. USE THIS instead of "main", "nav", or "header" which may not exist in all SPAs.
- NEVER use "main" as a CSS selector — many SPAs do not have a <main> element
- For settings/admin pages with no form data: navigate → wait 2000 → assert css "body" → screenshot is a COMPLETE and VALID scenario

Available actions: navigate, click, fill, assert, wait, screenshot, scroll, hover, press, evaluate, waitForUrl

Return a JSON array of QAScenario objects. Each step MUST have timeout set for assert/waitForUrl:
{
  id: string,
  name: string,
  category: "auth" | "navigation" | "form" | "api" | "ui" | "security" | "performance",
  priority: "critical" | "high" | "medium" | "low",
  preconditions: string[],
  steps: Array<{
    action: "navigate"|"click"|"fill"|"assert"|"wait"|"screenshot"|"scroll"|"hover"|"press"|"evaluate"|"waitForUrl",
    target?: { testId?: string, ariaLabel?: string, text?: string, css?: string, xpath?: string, role?: string },
    value?: string,
    description: string,
    timeout?: number
  }>,
  expectedResult: string,
  tags: string[]
}

Return ONLY the JSON array.`;
}
