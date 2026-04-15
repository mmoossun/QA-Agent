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

export const AGENT_SCENARIO_SYSTEM = `You are a QA scenario architect.
Given a site structure, generate comprehensive test scenarios covering:
- Happy path (primary user journey)
- Edge cases (boundary conditions, invalid inputs)
- Security (XSS attempts, auth bypass)
- UI consistency
- Error handling

For each scenario, provide Playwright-ready steps with fallback selectors.
Score each scenario by: priority * coverage * risk.`;

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

export function buildScenarioGenPrompt(structure: SiteStructure): string {
  return `Generate comprehensive QA test scenarios for this site.

Site Analysis:
${JSON.stringify(structure, null, 2)}

Requirements:
1. Cover ALL discovered routes and forms
2. Test auth flows FIRST (highest priority)
3. Include happy path + at least 2 edge cases per critical flow
4. Use multi-fallback selectors: testId > ariaLabel > text > css
5. Add screenshot steps at key checkpoints
6. Mark payment/auth flows as "critical" priority
7. Generate 10-20 scenarios total

Return a JSON array of QAScenario objects matching this TypeScript interface:
{
  id: string,
  name: string,
  category: "auth" | "navigation" | "form" | "api" | "ui" | "security" | "performance",
  priority: "critical" | "high" | "medium" | "low",
  preconditions: string[],
  steps: Array<{
    action: "navigate" | "click" | "fill" | "assert" | "wait" | "screenshot" | "scroll" | "hover" | "press",
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
