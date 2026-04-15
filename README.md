# QA Agent — AI-Powered QA Automation

자연어 한 줄로 테스트 시나리오를 생성하고, Playwright가 실제 브라우저에서 자동으로 실행하는 AI QA 자동화 시스템입니다.

> **AI Provider**: Claude (Anthropic) 또는 OpenAI 중 선택 가능, 런타임에 즉시 전환

![Next.js](https://img.shields.io/badge/Next.js-14-black)
![TypeScript](https://img.shields.io/badge/TypeScript-5-blue)
![Playwright](https://img.shields.io/badge/Playwright-1.x-green)
![OpenAI](https://img.shields.io/badge/OpenAI-Responses_API-orange)
![Claude](https://img.shields.io/badge/Claude-Anthropic-purple)

---

## 주요 기능

### Quick Run
사전 정의된 시나리오를 즉시 실행합니다. 로그인 인증 정보를 입력하면 버튼 하나로 전체 QA 플로우를 테스트합니다.
- 다중 세션(Owner / Admin / Agent / Viewer / Isolated) 지원
- ZeroTalk 대시보드 + 위젯 환경 특화 시나리오 43개
- PASS / FAIL 결과를 실시간으로 표시

### Chat QA
자연어로 시나리오를 생성하고, 여러 URL에 동시 실행합니다.
- "로그인 후 설정 페이지에서 프로필을 수정하는 시나리오를 만들어줘" 형태로 입력
- 다수의 대상 URL 지정 (URL별 로그인 정보 개별 설정 가능)
- 생성 즉시 실행(바로 실행 ON) 또는 시나리오 확인 후 수동 실행

### Auto Agent
URL을 주면 사이트를 자율 탐색하고, 시나리오를 AI가 직접 설계하고, Playwright로 실행합니다.
- **4단계 파이프라인**: 탐색 → 시나리오 생성 → 실행 → 리포트
- 다중 URL 순차 실행
- 7개 카테고리 선택 (auth / form / ui / navigation / security / api / performance)
- SSE(Server-Sent Events)로 실시간 진행 상황 스트리밍

---

## 아키텍처

```
┌─────────────────────────────────────────────────┐
│                  Next.js App Router              │
│  /run        /chat        /agent    /dashboard   │
└────────────────────┬────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────┐
│              API Routes (SSE / REST)             │
│  /api/chat   /api/qa/run   /api/agent/run        │
│  /api/config/provider   /api/evaluate            │
└────┬──────────────────────────┬─────────────────┘
     │                          │
┌────▼─────────┐    ┌───────────▼──────────────────┐
│  AI Layer    │    │       Agent Pipeline          │
│  claude.ts   │    │  Explorer → ScenarioGen       │
│  openai.ts   │    │  QARunner → Reporter          │
│  prompts.ts  │    └───────────┬──────────────────┘
└────┬─────────┘                │
     │              ┌───────────▼──────────────────┐
     └──────────────►    Playwright (Chromium)      │
                    │  selector.ts / runner.ts      │
                    └──────────────────────────────┘
```

### Agent 파이프라인 상세

| 단계 | 모듈 | 설명 |
|------|------|------|
| 1. Explore | `lib/agent/explorer` | Playwright로 사이트 탐색 (SPA 라우트 포함), AI로 구조 분석 |
| 2. Generate | `lib/agent/scenario-gen` | 실제 credentials 주입, assert/waitForUrl 필수 조건 시나리오 생성 |
| 3. Run | `lib/qa/runner` | Auth state 캐싱(1회 로그인 재사용), Auth 시나리오는 clean context 분리 실행 |
| 4. Report | `lib/agent/reporter` | 버그 리포트, 점수(0–100), 개선 권고 생성 |

---

## 기술 스택

| 영역 | 기술 |
|------|------|
| Framework | Next.js 14 (App Router) |
| Language | TypeScript 5 |
| AI (Claude) | Anthropic SDK — `claude-opus-4-6` |
| AI (OpenAI) | OpenAI SDK v6 — `gpt-4o` (Responses API) |
| Browser | Playwright (Chromium) |
| Styling | Tailwind CSS |
| Logging | Pino |
| DB | Prisma + SQLite |

---

## 시작하기

### 1. 의존성 설치

```bash
npm install
```

### 2. 환경 변수 설정

`.env` 파일을 생성하고 다음을 입력합니다.

```env
# AI Provider 선택: "claude" 또는 "openai"
AI_PROVIDER=openai

# OpenAI (gpt-4o 사용)
OPENAI_API_KEY=sk-...

# Claude (Anthropic)
ANTHROPIC_API_KEY=sk-ant-...

# 기타
DATABASE_URL="file:./dev.db"
NEXT_PUBLIC_APP_URL=http://localhost:3000
PLAYWRIGHT_HEADLESS=true
```

### 3. 개발 서버 실행

```bash
npm run dev
```

`http://localhost:3000`에서 앱을 확인합니다.

---

## AI Provider 전환

네비게이션 우측의 **Claude / OpenAI 토글 버튼**을 클릭하면 현재 실행 중인 프로세스를 재시작하지 않고도 즉시 전환됩니다.

또는 API로 직접 전환:

```bash
# OpenAI로 전환
curl -X POST http://localhost:3000/api/config/provider \
  -H "Content-Type: application/json" \
  -d '{"provider": "openai"}'

# Claude로 전환
curl -X POST http://localhost:3000/api/config/provider \
  -H "Content-Type: application/json" \
  -d '{"provider": "claude"}'
```

---

## 스코어링 시스템

Auto Agent 실행 후 0–100점 QA 점수를 반환합니다.

| 항목 | 비중 | 설명 |
|------|------|------|
| QA Quality | 40% | 시나리오 커버리지, assertion 커버율, 셀렉터 품질 |
| Exec Reliability | 20% | 셀렉터 오류율, 타이밍 실패, 재시도 없이 통과율 |
| AI Quality | 20% | 시나리오 명확성, 엣지케이스 포함 여부 |
| Code Quality | 10% | TypeScript 타입, 에러 핸들링, 로깅 |
| Performance | 10% | 평균 시나리오 실행 시간 |

> 현재 기준 점수: **87/100** (ZeroTalk 환경, 6개 시나리오 기준)

---

## 프로젝트 구조

```
QA_APP/
├── app/
│   ├── run/           # Quick Run 페이지
│   ├── chat/          # Chat QA 페이지
│   ├── agent/         # Auto Agent 페이지
│   ├── dashboard/     # 결과 대시보드
│   └── api/
│       ├── chat/      # 시나리오 생성 API
│       ├── qa/run/    # Playwright 실행 API
│       ├── agent/run/ # Agent 파이프라인 API (SSE)
│       └── config/    # Provider 설정 API
├── components/
│   ├── chat/          # ChatInterface 컴포넌트
│   └── ProviderSwitcher.tsx
├── lib/
│   ├── ai/
│   │   ├── claude.ts  # Claude 클라이언트 + provider 라우팅
│   │   ├── openai.ts  # OpenAI Responses API 클라이언트
│   │   ├── prompts.ts # 시스템 프롬프트 + 퓨샷 예제
│   │   └── types.ts   # 공유 타입 정의
│   ├── agent/
│   │   ├── explorer/  # 사이트 탐색기
│   │   ├── scenario-gen/ # AI 시나리오 생성기
│   │   ├── runner/    # Agent 오케스트레이터
│   │   └── reporter/  # 리포트 생성기
│   ├── qa/
│   │   ├── runner.ts  # Playwright 실행 엔진
│   │   └── selector.ts # 다중 전략 셀렉터 리졸버
│   └── evaluation/
│       └── scorer.ts  # 5차원 품질 스코어링
└── next.config.mjs
```

---

## 라이선스

MIT
