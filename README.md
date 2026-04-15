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

### Auto Agent *(범용 — 모든 웹 서비스에 적용 가능)*
URL을 주면 사이트를 자율 탐색하고, 시나리오를 AI가 직접 설계하고, Playwright로 실행합니다.

**4단계 파이프라인**: 탐색 → 시나리오 생성 → 실행 → 리포트

| 기능 | 설명 |
|------|------|
| 시나리오 시트 업로드 | CSV / JSON / TSV 파일로 기존 테스트 케이스를 AI 생성 시나리오와 병합 실행 |
| 시나리오만 생성 | 실행 없이 탐색 + 생성만 수행 후 JSON으로 다운로드 |
| 자연어 커스텀 프롬프트 | AI 시나리오 생성에 사용자 지침을 직접 추가 |
| 실시간 진행 스트리밍 | SSE(Server-Sent Events)로 진행률, 단계, 메시지를 실시간 표시 |
| 로그인 없는 사이트 지원 | 위젯·공개 페이지 등 로그인 폼이 없는 사이트도 자동 탐색 |

- 7개 카테고리 선택: auth / form / ui / navigation / security / api / performance
- Auth state 캐싱으로 로그인 1회 후 전 시나리오 재사용
- **최신 벤치마크: 94/100** (14개 시나리오, Pass rate 92.9%)

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
│  /api/agent/generate   /api/config/provider      │
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
| 1. Explore | `lib/agent/explorer` | Playwright로 사이트 탐색 (SPA/MPA, 로그인 여부 자동 감지), AI로 구조 분석 |
| 2. Generate | `lib/agent/scenario-gen` | 실제 credentials 주입, postLoginUrl 패턴 기반 waitForUrl 생성, 시트/커스텀 프롬프트 병합 |
| 3. Run | `lib/qa/runner` | Auth state 캐싱(1회 로그인 재사용), Auth/Security는 clean context 분리 실행, 재시도(최대 2회) |
| 4. Report | `lib/agent/reporter` | 버그 리포트, 0–100 점수, 개선 권고 생성 |

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

## Auto Agent 사용법

### 기본 실행
1. **대상 URL** 입력
2. **로그인 정보** 입력 (없으면 비워도 됨)
3. **카테고리** 선택
4. **에이전트 시작** 클릭 → 탐색 → 생성 → 실행 → 리포트 순으로 진행

### 시나리오 시트 업로드
CSV / JSON / TSV 형식의 기존 테스트 케이스를 업로드하면 AI 생성 시나리오와 병합하여 실행합니다.

CSV 형식 예시:
```csv
id,name,category,priority,steps,expectedResult
TC-001,로그인 테스트,auth,critical,"navigate /login | fill email test@co.kr | click submit",대시보드로 이동
```

### 시나리오만 생성
실행 없이 시나리오만 만들고 싶다면 **📋 시나리오만 생성** 버튼을 클릭합니다.
생성된 시나리오는 JSON으로 다운로드할 수 있습니다.

### 커스텀 프롬프트
AI 시나리오 생성에 추가 지침을 입력합니다.
예: "결제 플로우를 집중적으로 테스트해줘", "한국어 입력만 사용해줘"

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

> 최신 벤치마크: **94/100** (2026-04-16, 14개 시나리오, Pass rate 92.9%, 149초)

---

## E2E 테스트 스크립트

Agent 파이프라인 전체를 자동으로 검증합니다.

```bash
npx tsx scripts/run-agent-test.ts
```

- 목표 점수 90점 이상이면 exit 0, 미달이면 exit 1
- 실시간 진행 바 + 최종 시나리오별 결과 출력
- Node `http` 모듈 사용 — SSE 스트림이 10분+ 이어져도 timeout 없음

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
│       ├── agent/generate/ # 탐색+생성 전용 API (SSE)
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
│   │   ├── explorer/  # 사이트 탐색기 (SPA/MPA, 로그인 자동 감지)
│   │   ├── scenario-gen/ # AI 시나리오 생성기
│   │   ├── runner/    # Agent 오케스트레이터
│   │   └── reporter/  # 리포트 생성기
│   ├── qa/
│   │   ├── runner.ts  # Playwright 실행 엔진 (auth 캐싱, 재시도)
│   │   └── selector.ts # 다중 전략 셀렉터 리졸버
│   └── evaluation/
│       └── scorer.ts  # 5차원 품질 스코어링
└── scripts/
    └── run-agent-test.ts  # Agent E2E 테스트 스크립트 (목표 90점)
```

---

## 라이선스

MIT
