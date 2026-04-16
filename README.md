# QA Agent — AI-Powered QA Automation

자연어 한 줄로 테스트 시나리오를 생성하고, AI가 실제 브라우저에서 사람처럼 QA를 수행하는 AI QA 자동화 시스템입니다.

> **AI Provider**: OpenAI (기본값) · Claude 선택 가능

![Next.js](https://img.shields.io/badge/Next.js-14-black)
![TypeScript](https://img.shields.io/badge/TypeScript-5-blue)
![Playwright](https://img.shields.io/badge/Playwright-1.44-green)
![OpenAI](https://img.shields.io/badge/GPT--4o-OpenAI-orange)
![Qwen3-VL](https://img.shields.io/badge/Qwen3--VL-OpenRouter-blue)

---

## 주요 기능

### Quick Run
사전 정의된 시나리오를 즉시 실행합니다.
- 다중 세션(Owner / Admin / Agent / Viewer / Isolated) 지원
- ZeroTalk 대시보드 + 위젯 환경 특화 시나리오 43개
- PASS / FAIL 결과 실시간 표시

### Chat QA
자연어로 시나리오를 생성하고 여러 URL에 동시 실행합니다.
- `"로그인 후 설정 페이지에서 프로필을 수정하는 시나리오를 만들어줘"` 형태로 입력
- URL별 로그인 정보 개별 설정
- 생성 즉시 실행 또는 확인 후 수동 실행

### Auto Agent *(범용 — 모든 웹 서비스)*
URL을 주면 사이트를 자율 탐색하고 AI가 시나리오를 설계해 Playwright로 실행합니다.

**4단계 파이프라인**: 탐색 → 시나리오 생성 → 실행 → 리포트

| 기능 | 설명 |
|------|------|
| 시나리오 시트 업로드 | xlsx / CSV / JSON / TSV 업로드 → AI가 자유 해석 후 시나리오에 반영 |
| 시나리오만 생성 | 실행 없이 탐색 + 생성만 수행 후 JSON 다운로드 |
| 자연어 커스텀 프롬프트 | AI 시나리오 생성에 사용자 지침 추가 |
| 실시간 진행 스트리밍 | SSE로 진행률·단계·메시지 실시간 표시 |
| 다중 대상 URL | 여러 URL을 순차 실행, URL별 계정 정보 설정 |
- 7개 카테고리: 기능 테스트 / UI/UX / 엣지 케이스 / 보안 / 성능 / 접근성 / 회귀

### Auto Agent (Human-mode) *(신규)*
AI가 실제 사람처럼 브라우저를 조작하며 QA를 수행합니다. 스크린샷 기반 비전 인식과 실제 DOM 추출을 결합한 하이브리드 아키텍처입니다.

---

## Human-mode Agent 아키텍처

### 매 스텝 실행 흐름

```
스크린샷 촬영
    ├─ Qwen3-VL (병렬)         → 한국어 OCR + 화면 상태 파악
    └─ CDP A11y Tree (병렬)    → @e1~@e60 인터랙티브 요소 목록
              ↓
        GPT-4o 플래너
        - A11Y_REFS에서만 @ref 선택 (실제 존재하는 셀렉터)
        - Qwen 설명은 상황 파악용 (시각 컨텍스트)
        - 이전 실패 에러 주입 (Reflection)
        - 목표 매 스텝 고정 (Context overflow 방지)
              ↓
        Playwright 실행
        - getByRole(role, {name}) — A11y 기반 가장 안정적인 로케이터
        - 실패 시 getByText → getByLabel 폴백
              ↓
        GPT-4o-mini Validator
        - 액션 후 스크린샷으로 결과 검증
        - 실패 시 "이유 + 대안" 다음 스텝에 주입
```

### 신뢰성 개선 장치

| 기능 | 설명 |
|------|------|
| CDP Accessibility Tree | Chrome DevTools Protocol로 실제 접근성 트리 추출 → CSS 추측 없음 |
| @ref ID 시스템 | `@e1`, `@e2`... 짧은 ref로 요소 지정 — 토큰 80% 절감 |
| Validator Agent | GPT-4o-mini가 매 액션 후 결과 검증 (Skyvern 패턴) |
| Failure Reflection | 실패 원인을 다음 플래닝 스텝에 주입 |
| A11y 캐싱 | 동일 URL에서 CDP 재스캔 생략 (navigate/click 후 자동 무효화) |
| 스톨 감지 | 동일 액션 3회 반복 시 강제 스크롤 + 리셋 |
| 히스토리 압축 | 최근 4스텝 풀 유지, 이전 스텝은 1줄 요약 |

### Human-mode 전용 기능

#### 📋 케이스 생성 모드
브라우저 실행 없이 GPT-4o가 구조화된 테스트 케이스만 작성합니다.

- **ID / 카테고리 / 제목 / 스텝 / 기대결과 / 우선순위** 구조
- 상태 배지 클릭으로 `Not Run → Pass → Fail → Skip` 순환
- CSV 다운로드
- Google Sheets 내보내기 / 불러오기

#### ▶ 직접 실행 모드
Human-mode 에이전트가 실제 브라우저를 조작하며 QA를 수행합니다.

#### 📊 Google Sheets 연동
생성된 테스트 케이스를 Google 스프레드시트에 자동 저장하거나 기존 시트에서 불러옵니다.

---

## 아키텍처

```
┌─────────────────────────────────────────────────────────────┐
│                      Next.js App Router                      │
│  /run    /chat    /agent    /human-agent    /dashboard        │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│                  API Routes (SSE / REST)                      │
│  /api/qa/run          /api/agent/run       /api/agent/generate│
│  /api/human-agent/run /api/human-agent/generate              │
│  /api/google-sheets   /api/screenshots/:f  /api/reports/:f   │
└──────┬────────────────────────────────────┬─────────────────┘
       │                                    │
┌──────▼──────────┐            ┌────────────▼────────────────┐
│    AI Layer     │            │       Pipeline               │
│  openai.ts      │            │  Auto Agent:                 │
│  claude.ts      │            │    Explorer → ScenarioGen    │
│  qwen.ts        │            │    QARunner → Reporter       │
│  (GPT-4o-mini   │            │  Human Agent:                │
│   Validator)    │            │    Qwen3-VL + CDP A11y       │
└──────┬──────────┘            │    GPT-4o Planner            │
       │                       │    Validator Agent           │
       └───────────────────────►  Playwright (Chromium)       │
                               └─────────────────────────────┘
```

### Auto Agent 파이프라인

| 단계 | 모듈 | 설명 |
|------|------|------|
| 1. Explore | `lib/agent/explorer` | Playwright로 사이트 탐색, SPA/MPA·로그인 여부 자동 감지 |
| 2. Generate | `lib/agent/scenario-gen` | credentials 주입, 시트/커스텀 프롬프트 병합, 시나리오 생성 |
| 3. Run | `lib/qa/runner` | Auth state 캐싱(1회 로그인 재사용), Auth/Security 클린 컨텍스트 분리, 재시도(최대 2회) |
| 4. Report | `lib/agent/reporter` | 버그 리포트, 0–100 점수, 개선 권고 생성 |

---

## 기술 스택

| 영역 | 기술 |
|------|------|
| Framework | Next.js 14 (App Router) |
| Language | TypeScript 5 |
| AI — Planning | OpenAI GPT-4o |
| AI — Validation | OpenAI GPT-4o-mini |
| AI — Vision/OCR | Qwen3-VL 235B via OpenRouter |
| AI — Claude | Anthropic claude-opus-4-6 (선택) |
| Browser | Playwright 1.44 (Chromium + CDP) |
| Styling | Tailwind CSS |
| Logging | Pino |
| DB | Prisma + SQLite |
| Sheets | Google Sheets API v4 (OAuth2) |

---

## 시작하기

### 1. 의존성 설치

```bash
npm install
npx playwright install chromium
```

### 2. 환경 변수 설정

`.env` 파일을 생성합니다.

```env
# ── AI Providers ───────────────────────────────────
# 기본값: openai
AI_PROVIDER=openai

# OpenAI (GPT-4o — 플래닝 + Validator)
OPENAI_API_KEY=sk-...

# Anthropic Claude (선택)
ANTHROPIC_API_KEY=sk-ant-...

# OpenRouter (Qwen3-VL 235B — Human Agent 화면 인식)
OPENROUTER_API_KEY=sk-or-v1-...

# ── Google Sheets (선택) ────────────────────────────
# 설정 방법: npx node scripts/get-google-token.js 실행
GOOGLE_CLIENT_ID=xxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-...
GOOGLE_REFRESH_TOKEN=1//...

# ── 기타 ───────────────────────────────────────────
DATABASE_URL="file:./dev.db"
NEXT_PUBLIC_APP_URL=http://localhost:3000
NODE_ENV=development
PLAYWRIGHT_HEADLESS=true
PLAYWRIGHT_SLOW_MO=0
TARGET_SCORE=80
```

### 3. 개발 서버 실행

```bash
npm run dev
```

`http://localhost:3000`에서 앱을 확인합니다.

---

## Auto Agent 사용법

1. **대상 URL** 입력 (여러 개 추가 가능)
2. **로그인 정보** 입력 (없으면 비워도 됨)
3. **카테고리** 선택
4. **시나리오 시트** 업로드 (선택 — xlsx/csv/tsv/json, AI가 자유 해석)
5. **에이전트 시작** → 탐색 → 생성 → 실행 → 리포트

---

## Human-mode Agent 사용법

### 📋 케이스 생성 모드
1. **대상 URL + 테스트 목표** 입력
2. **카테고리 / 지시사항** 설정
3. **테스트 케이스 생성** 클릭
4. 생성된 케이스 확인 → **CSV 다운로드** 또는 **Google 시트에 내보내기**

### ▶ 직접 실행 모드
1. **대상 URL + 목표 + 최대 스텝** 설정
2. **테스트 시작** 클릭
3. 매 스텝마다 스크린샷 + Qwen 인식 결과 + GPT-4o 판단 확인

---

## Google Sheets 연동 설정

서비스 계정 키 없이 **OAuth2 Refresh Token** 방식으로 인증합니다.

### 1회 설정

```bash
# 1. Google Cloud Console에서 OAuth2 클라이언트 생성
#    APIs & Services → Credentials → OAuth client ID → Desktop app

# 2. .env에 CLIENT_ID, CLIENT_SECRET 입력 후 실행
node scripts/get-google-token.js

# 3. 출력된 GOOGLE_REFRESH_TOKEN을 .env와 Render 환경변수에 추가
```

### 시트 ID 확인
스프레드시트 URL에서 `/d/` 다음 `/` 전까지:
```
https://docs.google.com/spreadsheets/d/[SHEET_ID]/edit
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

---

## 프로젝트 구조

```
QA_APP/
├── app/
│   ├── run/              # Quick Run 페이지
│   ├── chat/             # Chat QA 페이지
│   ├── agent/            # Auto Agent 페이지
│   ├── human-agent/      # Human-mode Agent 페이지
│   ├── dashboard/        # 결과 대시보드
│   └── api/
│       ├── qa/run/           # Playwright 실행 API
│       ├── agent/run/        # Auto Agent 파이프라인 (SSE)
│       ├── agent/generate/   # 탐색+생성 전용 (SSE)
│       ├── human-agent/run/  # Human Agent 실행 (SSE)
│       ├── human-agent/generate/ # 테스트 케이스 생성 API
│       ├── google-sheets/    # Google Sheets 읽기/쓰기 API
│       ├── screenshots/      # 스크린샷 파일 서빙
│       ├── reports/          # 리포트 파일 서빙
│       └── config/           # Provider 설정 API
├── lib/
│   ├── ai/
│   │   ├── claude.ts         # Claude 클라이언트 + provider 라우팅
│   │   ├── openai.ts         # GPT-4o 클라이언트 (Chat + Vision)
│   │   ├── qwen.ts           # Qwen3-VL via OpenRouter (화면 인식)
│   │   └── prompts.ts        # 시스템 프롬프트
│   ├── agent/
│   │   ├── explorer/         # 사이트 탐색기
│   │   ├── scenario-gen/     # AI 시나리오 생성기
│   │   ├── runner/           # Agent 오케스트레이터
│   │   └── reporter/         # 리포트 생성기
│   ├── human-agent/
│   │   └── runner.ts         # Human Agent v3
│   │                         #   CDP A11y Tree + @ref ID
│   │                         #   Qwen3-VL Perception
│   │                         #   GPT-4o Planner
│   │                         #   GPT-4o-mini Validator
│   │                         #   A11y Cache + Stall Detection
│   ├── google-sheets/
│   │   └── index.ts          # Google Sheets API 클라이언트 (OAuth2)
│   ├── qa/
│   │   ├── runner.ts         # Playwright 실행 엔진
│   │   └── selector.ts       # 다중 전략 셀렉터 리졸버
│   └── evaluation/
│       └── scorer.ts         # 5차원 품질 스코어링
└── scripts/
    ├── run-agent-test.ts     # Auto Agent E2E 테스트 스크립트
    └── get-google-token.ts   # Google OAuth2 Refresh Token 발급 (1회)
```

---

## 라이선스

MIT
