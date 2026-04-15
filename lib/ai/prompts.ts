import type { QAScenario, SiteStructure } from "./types";

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
2. Every auth scenario MUST include a "waitForUrl" step after login submit to verify the redirect actually happened.
3. Every scenario MUST include at least one "assert" or "waitForUrl" step. Screenshot-only scenarios are forbidden.
4. For error scenarios (wrong password, empty fields): assert that an error/alert element is visible.
5. Available actions: navigate, click, fill, assert, wait, screenshot, scroll, hover, press, evaluate, waitForUrl.
6. "waitForUrl" value must be a glob pattern like "**/w/**" or the full URL.
7. "assert" target should check a URL-verifiable element or visible error text.

SELECTOR RULES — wrong selectors cause 100% failure rate:
- Email inputs: ALWAYS use css "input[type='email']", NOT input[name='...']
- Password inputs: ALWAYS use css "input[type='password']", NOT input[name='...']
- If a field is described as 'input[placeholder="X"]' in the site structure, use that EXACT string as the css selector
- NEVER invent input[name='Korean text'] — Korean text in field descriptions is the placeholder, not the name attribute
- Submit buttons: use css "button[type='submit']"
- Failed login verification: assert that login form is still visible using css "input[type='email']" or "input[type='password']" (if still on login page = login failed). Do NOT rely on app-specific error CSS classes.
- If you need to verify an error toast/alert, use wait 2000 then assert "input[type='email']" still visible as the login-failed proof.

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

  return `Generate comprehensive QA test scenarios for this site.
${credSection}
Site Analysis:
${JSON.stringify(structure, null, 2)}

Requirements:
1. Cover ALL discovered routes and forms
2. Test auth flows FIRST (highest priority)
3. Include happy path + at least 2 edge cases per critical flow
4. Use multi-fallback selectors: testId > ariaLabel > text > css
5. After every login submit: add a "waitForUrl" step with value "**/w/**" to confirm redirect
6. For failed login tests: add an "assert" step checking for a visible error message (css: "[role='alert'], .error, [class*='error']")
7. Mark payment/auth flows as "critical" priority
8. Generate 10-20 scenarios total
9. Every scenario MUST contain at least one assert or waitForUrl step

Available actions: navigate, click, fill, assert, wait, screenshot, scroll, hover, press, evaluate, waitForUrl

Return a JSON array of QAScenario objects:
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
