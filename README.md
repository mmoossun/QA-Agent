# QA Agent — AI 기반 QA 자동화 시스템

> 자연어 한 줄로 테스트 시나리오를 생성하고, AI가 실제 사람처럼 브라우저를 조작해 QA를 수행합니다.

![Next.js](https://img.shields.io/badge/Next.js-14-black)
![TypeScript](https://img.shields.io/badge/TypeScript-5-blue)
![Playwright](https://img.shields.io/badge/Playwright-1.44-green)
![OpenAI](https://img.shields.io/badge/GPT--4o-OpenAI-orange)
![Prisma](https://img.shields.io/badge/Prisma-5-purple)

---

## 목차

1. [앱 소개](#1-앱-소개)
2. [핵심 기능 한눈에 보기](#2-핵심-기능-한눈에-보기)
3. [기술 원리 — 어떻게 동작하는가](#3-기술-원리--어떻게-동작하는가)
4. [처음 시작하기 — 로컬 개발 환경 설정](#4-처음-시작하기--로컬-개발-환경-설정)
5. [Render 배포 가이드](#5-render-배포-가이드)
6. [Auto Agent 완전 사용 가이드](#6-auto-agent-완전-사용-가이드)
7. [Chat QA 사용 가이드](#7-chat-qa-사용-가이드)
8. [리포트 사용 가이드](#8-리포트-사용-가이드)
9. [대시보드 사용 가이드](#9-대시보드-사용-가이드)
10. [Google Sheets 연동 설정](#10-google-sheets-연동-설정)
11. [환경변수 완전 가이드](#11-환경변수-완전-가이드)
12. [프로젝트 구조](#12-프로젝트-구조)
13. [스코어링 시스템](#13-스코어링-시스템)
14. [트러블슈팅](#14-트러블슈팅)

---

## 1. 앱 소개

**QA Agent**는 AI를 활용해 웹 서비스의 품질 보증(QA)을 자동화하는 시스템입니다.

기존 QA 자동화 도구와의 차이점:

| 기존 Playwright/Selenium | QA Agent |
|--------------------------|----------|
| 코드를 직접 작성해야 함 | 자연어로 목표만 설명하면 됨 |
| 선택자(selector)가 바뀌면 테스트 깨짐 | AI가 화면을 보고 스스로 요소 탐색 |
| UI 변경마다 코드 수정 필요 | 스크린샷 + 접근성 트리로 동적 인식 |
| 테스트 결과만 반환 | 버그 분석 + 원인 + 개선 권고까지 생성 |

**핵심 철학**: QA 엔지니어가 하듯이 — 화면을 보고, 판단하고, 클릭하고, 결과를 분석한다.

---

## 2. 핵심 기능 한눈에 보기

### Auto Agent (메인 기능)

AI가 실제 사람처럼 브라우저를 조작하며 QA를 수행합니다.

- **GPT-4o 비전**: 스크린샷을 직접 보고 화면 상태 파악
- **CDP 접근성 트리**: Chrome 내부 DOM 구조를 직접 읽어 정확한 요소 탐색
- **단계별 실시간 스트리밍**: 매 스텝마다 스크린샷 + AI 판단 결과 실시간 표시
- **자동 리포트 생성**: 테스트 완료 후 GPT-4o가 버그 분석 리포트 자동 생성
- **영구 저장**: 리포트를 PostgreSQL DB에 저장해 언제든 재열람 가능

### Chat QA

자연어로 시나리오를 생성하고 여러 URL에 동시 실행합니다.

### 리포트

저장된 QA 리포트를 열람하고 HTML/JSON으로 내보냅니다.

### 대시보드

전체 테스트 실행 기록과 점수 추이를 확인합니다.

---

## 3. 기술 원리 — 어떻게 동작하는가

### 3.1 Auto Agent v4 전체 흐름

```
사용자 입력 (URL + 목표 + 최대 스텝)
          │
          ▼
    [로그인 처리]  ← 이메일/비밀번호 제공 시 자동 로그인
          │
          ▼
┌─────────────────────────────────────────────────┐
│                  매 스텝 루프                      │
│                                                  │
│  ┌──────────────────┐  ┌───────────────────────┐ │
│  │ 스크린샷 캡처    │  │ CDP 접근성 트리 추출   │ │
│  │ (Playwright)     │  │ (@e1, @e2 ... @e60)    │ │
│  └────────┬─────────┘  └──────────┬────────────┘ │
│           │  (병렬 실행)           │              │
│           └─────────┬─────────────┘              │
│                     ▼                             │
│            [GPT-4o 비전 + 플래닝]                 │
│            - 화면을 보고 상황 파악                 │
│            - 다음 액션 결정 (클릭/입력/이동)       │
│            - 실패 이유 반영 (Reflection)           │
│                     │                             │
│                     ▼                             │
│            [Playwright 실행]                      │
│            전략 1: getByRole(역할, {이름})         │
│            전략 2: getByText(텍스트)              │
│            전략 3: CDP 직접 클릭 (iframe 등)      │
│                     │                             │
│                     ▼                             │
│            [GPT-4o-mini 검증]                     │
│            - 액션이 성공했는가?                    │
│            - 실패 시 원인 분석 → 다음 스텝 반영   │
│                     │                             │
│            [종료 조건 체크]                        │
│            - 목표 달성? → 완료                    │
│            - 최대 스텝 도달? → 완료               │
│            - 버그 발견? → 기록 후 계속            │
└─────────────────────────────────────────────────┘
          │
          ▼
    [GPT-4o 리포트 생성]
    - 전체 스텝 분석
    - 버그/경고/정보 항목 분류
    - 리스크 레벨 산정 (low/medium/high/critical)
    - 개선 권고 생성
          │
          ▼
    [PostgreSQL DB 저장]
```

### 3.2 핵심 기술: @ref ID 시스템

기존 방식의 문제점:
```
❌ "id='btn-submit-form-2024' class='btn btn-primary disabled:opacity-50...' 를 클릭"
   → 토큰 수백 개 낭비, AI 혼란
```

QA Agent의 해결책:
```
✅ "@e7 을 클릭"
   → CDP로 실제 DOM에서 추출한 버튼 → @e7 이라는 짧은 ID 부여
   → AI는 @e7 만 지정하면 Playwright가 정확한 요소 찾아 클릭
```

**효과**: 프롬프트 토큰 80% 절감, 더 정확한 요소 탐색

### 3.3 핵심 기술: CDP (Chrome DevTools Protocol)

Playwright 기본 동작 외에도 Chrome의 내부 API를 직접 사용합니다.

```
일반 Playwright    →  CSS 선택자나 텍스트로 요소 탐색
CDP 접근성 트리   →  Chrome이 직접 제공하는 실제 DOM 구조 읽기
CDP 직접 클릭     →  iframe 내부 버튼도 좌표 오류 없이 정확히 클릭
```

**특히 유용한 케이스**: iframe 안에 삽입된 채팅 위젯, 결제 폼 등

### 3.4 신뢰성 보장 장치

| 장치 | 설명 |
|------|------|
| **A11y 트리 캐싱** | 같은 페이지에서는 재추출 없이 캐시 사용 → 속도 향상 |
| **스톨 감지** | 같은 액션을 3번 반복하면 강제 스크롤 후 리셋 |
| **히스토리 압축** | 최근 6스텝은 전체 보존, 오래된 스텝은 1줄 요약 → 컨텍스트 오버플로 방지 |
| **45초 타임아웃** | 스텝당 최대 45초, 초과 시 실패로 기록 후 다음 스텝 진행 |
| **Failure Reflection** | 실패 원인을 다음 스텝 프롬프트에 자동 주입 |

### 3.5 데이터 저장 구조

```
사용자 테스트 실행
    │
    ├── PostgreSQL (Render)
    │   └── SavedReport 테이블
    │       ├── 리포트 메타데이터 (URL, 점수, 리스크 레벨...)
    │       ├── findings[]     (버그/경고 목록 — JSON)
    │       ├── steps[]        (전체 스텝 기록 — JSON)
    │       └── recommendations[] (개선 권고 — JSON)
    │
    └── 파일 시스템 (public/screenshots/)
        └── {uuid}.png  (각 스텝 스크린샷)
```

---

## 4. 처음 시작하기 — 로컬 개발 환경 설정

### 준비물

- **Node.js 20** 이상 ([nodejs.org](https://nodejs.org))
- **Git**
- **OpenAI API 키** ([platform.openai.com](https://platform.openai.com))

### 4.1 코드 다운로드

```bash
git clone https://github.com/mmoossun/QA-Agent.git
cd QA-Agent
```

### 4.2 패키지 설치

```bash
npm install
```

### 4.3 Playwright Chromium 브라우저 설치

```bash
npx playwright install chromium
```

> AI가 실제로 조작할 Chrome 브라우저를 설치합니다. 약 150MB.

### 4.4 환경변수 설정

프로젝트 루트에 `.env` 파일을 생성합니다:

```env
# ── 필수: AI 제공자 ─────────────────────────────────
AI_PROVIDER=openai
OPENAI_API_KEY=sk-proj-...

# ── 선택: Claude 사용 시 ────────────────────────────
ANTHROPIC_API_KEY=sk-ant-...

# ── 데이터베이스 (로컬은 SQLite) ────────────────────
DATABASE_URL="file:./prisma/dev.db"

# ── 앱 설정 ─────────────────────────────────────────
NEXT_PUBLIC_APP_URL=http://localhost:3000
NODE_ENV=development
PLAYWRIGHT_HEADLESS=true
PLAYWRIGHT_SLOW_MO=0

# ── 선택: Google Sheets 연동 ────────────────────────
GOOGLE_CLIENT_ID=xxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-...
GOOGLE_REFRESH_TOKEN=1//...

# ── Auto-improve 설정 ────────────────────────────────
TARGET_SCORE=80
IMPROVE_MAX_ITERATIONS=10
```

### 4.5 데이터베이스 초기화

```bash
npx prisma db push
```

> SQLite 파일(`prisma/dev.db`)을 생성하고 테이블을 만듭니다.

### 4.6 개발 서버 실행

```bash
npm run dev
```

브라우저에서 [http://localhost:3000](http://localhost:3000) 접속.

### 4.7 정상 동작 확인

1. 상단 탭에서 **Auto Agent** 클릭
2. 테스트할 URL 입력 (예: `https://example.com`)
3. 목표 입력 (예: `페이지를 탐색하고 주요 기능을 확인하세요`)
4. **테스트 시작** 클릭
5. 스텝이 실시간으로 표시되면 정상

---

## 5. Render 배포 가이드

### 5.1 PostgreSQL 데이터베이스 생성

1. [render.com](https://render.com) 로그인
2. **New** → **PostgreSQL** 클릭
3. 설정:
   - **Name**: `qa-agent-db` (원하는 이름)
   - **Plan**: Free
4. **Create Database** 클릭
5. 생성 완료 후 **Internal Database URL** 복사 (나중에 사용)

### 5.2 웹 서비스에 환경변수 추가

1. Render 대시보드에서 QA Agent 웹 서비스 선택
2. **Environment** 탭 클릭
3. `DATABASE_URL` 값을 5.1에서 복사한 PostgreSQL URL로 변경
4. **Save Changes** 클릭

### 5.3 자동 배포 확인

- GitHub에 코드를 push하면 Render가 자동으로 재배포
- 배포 시 `npm start` 가 실행되며, 이 때 `prisma db push`로 테이블 자동 생성
- 배포 로그에서 `✔ Your database is now in sync` 메시지 확인

### 5.4 필수 환경변수 목록 (Render)

Render **Environment** 탭에 다음을 모두 추가해야 합니다:

```
OPENAI_API_KEY         = sk-proj-...
DATABASE_URL           = postgresql://...   (PostgreSQL 내부 URL)
NEXT_PUBLIC_APP_URL    = https://your-app.onrender.com
NODE_ENV               = production
PLAYWRIGHT_HEADLESS    = true
AI_PROVIDER            = openai
```

선택 (Google Sheets 연동 시):
```
GOOGLE_CLIENT_ID       = xxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET   = GOCSPX-...
GOOGLE_REFRESH_TOKEN   = 1//...
```

---

## 6. Auto Agent 완전 사용 가이드

Auto Agent는 이 앱의 핵심 기능입니다. AI가 실제 브라우저를 조작하며 QA를 수행합니다.

### 6.1 화면 구성

```
┌──────────────────────────────────────────────────────────┐
│  Auto Agent                                               │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  대상 URL       [https://example.com            ]        │
│  목표           [로그인 후 설정 페이지를 테스트  ]        │
│  로그인 이메일  [test@example.com               ]        │
│  로그인 비밀번호[••••••••                        ]        │
│  최대 스텝      [20]    카테고리 [기능 테스트 ▼]         │
│                                                          │
│  [테스트 시작]  [테스트 케이스 생성]                      │
│                                                          │
├──────────────────────────────────────────────────────────┤
│  실행 중...                                               │
│                                                          │
│  Step 1 ✅                                                │
│  [스크린샷]  메인 페이지가 표시됩니다. 로그인 버튼...     │
│                                                          │
│  Step 2 ✅                                                │
│  [스크린샷]  로그인 폼이 나타났습니다. 이메일 입력...     │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

### 6.2 입력 항목 설명

| 항목 | 필수 | 설명 |
|------|------|------|
| **대상 URL** | ✅ | 테스트할 웹 페이지 주소 |
| **목표** | ✅ | AI에게 무엇을 테스트할지 설명. 구체적일수록 좋음 |
| **로그인 이메일/비밀번호** | ❌ | 로그인이 필요한 서비스면 입력. 없으면 비로그인 상태로 테스트 |
| **최대 스텝** | ✅ | AI가 최대 몇 번의 액션을 수행할지. 기본값 20, 복잡한 테스트는 30~40 |
| **카테고리** | ❌ | 테스트 유형 힌트 (기능/UI/보안/성능 등) |

### 6.3 목표 작성 팁

**좋은 예시:**
```
✅ "로그인 → 마이페이지 → 프로필 수정 → 저장 후 변경 확인"
✅ "상품 검색 → 장바구니 추가 → 결제 페이지 진입까지 테스트"
✅ "채팅 위젯을 열고 메시지를 보낸 후 응답이 오는지 확인"
```

**나쁜 예시:**
```
❌ "전부 테스트해줘"  → 너무 모호함
❌ "버튼 클릭"        → 어떤 버튼인지 불명확
```

### 6.4 테스트 케이스 생성 모드

**테스트 케이스 생성** 버튼을 클릭하면 브라우저 실행 없이 테스트 케이스 목록만 생성합니다.

- 각 케이스: ID / 제목 / 단계 / 기대 결과 / 우선순위
- 상태 배지 클릭: `Not Run → Pass → Fail → Skip` 순환
- **CSV 다운로드**: 스프레드시트로 내보내기
- **Google 시트 내보내기**: 기존 시트 양식에 맞게 데이터 행 추가 (기존 내용 보존)
- **Google 시트에서 불러오기**: 기존 케이스를 가져와 편집 가능

### 6.5 Google Sheets 양식 맞춤 생성

기존 Google Sheets나 업로드 파일의 컬럼 구조에 맞게 테스트 케이스를 생성할 수 있습니다.

#### 방법 1: 시트 ID 입력 후 양식 분석

1. 시트 ID 입력 → 탭 자동 로드
2. **📊 시트 양식 분석** 버튼 클릭
3. 감지된 컬럼 배지 확인 (보라색 = 표준 필드 매핑, 회색 = 커스텀 컬럼)
4. **테스트 케이스 생성** → AI가 시트의 컬럼 순서·언어·값 형식에 맞게 생성

```
예: 시트의 우선순위 컬럼에 "높음/중간/낮음" 샘플이 있으면
    → AI가 한국어로 "높음/중간/낮음" 형식으로 생성

    시트의 우선순위 컬럼에 "High/Medium/Low" 샘플이 있으면
    → AI가 영어로 "High/Medium/Low" 형식으로 생성
```

#### 방법 2: 파일 업로드 시 자동 감지

`.xlsx` · `.csv` · `.tsv` · `.json` 파일을 업로드하면 자동으로 컬럼 포맷이 감지됩니다. 별도 분석 버튼 없이 생성 시 자동 적용.

#### 내보내기 시 자동 분석

**📤 Google 시트에 내보내기** 버튼 클릭 시:
- 사전 분석을 안 했어도 → 자동으로 시트 양식 분석 후 내보내기
- 기존 데이터 아래에 행 삽입 (기존 내용 절대 삭제 안 함)
- 헤더 행 자동 탐지 (제목 행이 있어도 정확한 컬럼에 삽입)

### 6.5 실행 중 화면 읽는 법

매 스텝마다 표시되는 정보:

```
Step 3 ✅
┌──────────────┐
│  [스크린샷]  │  ← AI가 본 화면
└──────────────┘
인식: "설정 페이지가 열렸습니다. 프로필 편집 버튼(@e5)이 보입니다."
액션: @e5 클릭 (프로필 편집 버튼)
결과: 성공 — 편집 폼이 나타남
```

- ✅ = 스텝 성공
- ❌ = 스텝 실패 (AI가 원인 분석 후 다음 스텝에서 재시도)

### 6.6 리포트 저장

테스트 완료 후:
1. **리포트 저장** 버튼 클릭
2. 리포트 이름 입력 (기본값: 날짜 + URL)
3. **저장** 클릭
4. **리포트** 탭에서 언제든 재열람 가능

---

## 7. Chat QA 사용 가이드

자연어로 시나리오를 설명하면 AI가 Playwright 테스트를 생성하고 실행합니다.

### 7.1 사용법

1. **Chat QA** 탭 클릭
2. 테스트 시나리오를 자연어로 입력:
   ```
   "로그인 후 대시보드에서 새 프로젝트를 생성하고, 생성된 프로젝트가 목록에 표시되는지 확인해줘"
   ```
3. **대상 URL** + 로그인 정보 입력
4. **실행** 클릭

### 7.2 Auto Agent와의 차이점

| | Chat QA | Auto Agent |
|--|---------|------------|
| **동작 방식** | 시나리오를 코드로 변환 후 실행 | AI가 직접 화면을 보며 조작 |
| **적합한 케이스** | 명확한 단계가 있는 기능 테스트 | 탐색적 테스트, 복잡한 UI |
| **속도** | 빠름 | 상대적으로 느림 |
| **신뢰도** | 선택자 변경에 취약 | 화면 기반이라 변경에 강함 |

---

## 8. 리포트 사용 가이드

### 8.1 리포트 목록

**Reports** 탭에서 저장된 모든 리포트를 확인합니다.

```
┌──────────────────────────────────────────────────────────┐
│  저장된 리포트                                             │
├──────────────────────────────────────────────────────────┤
│  2025.01.15 — example.com             🔴 HIGH  75% pass  │
│  2025.01.14 — shop.example.com        🟡 MED   88% pass  │
│  2025.01.13 — app.example.com         🟢 LOW   95% pass  │
└──────────────────────────────────────────────────────────┘
```

각 항목에 표시되는 정보:
- **날짜**: 저장 시각
- **URL**: 테스트한 웹사이트
- **리스크 레벨**: 🔴 Critical / 🔴 High / 🟡 Medium / 🟢 Low
- **통과율**: 전체 스텝 중 성공한 비율

### 8.2 리포트 상세 보기

리포트 클릭 시 상세 내용:

**요약 섹션**
```
Executive Summary
"로그인 기능은 정상 동작하나, 프로필 수정 후 저장 버튼이
응답하지 않는 버그가 발견됨. 즉각적인 수정 필요."
```

**발견 사항 (Findings)**

| 유형 | 심각도 | 제목 | 설명 |
|------|--------|------|------|
| 🐛 Bug | High | 저장 버튼 미동작 | 프로필 수정 후 저장 클릭 시 반응 없음 |
| ⚠️ Warning | Medium | 느린 로딩 | 대시보드 로딩 4.2초 (권장: 2초 이내) |
| ℹ️ Info | Low | 모바일 뷰 | 모바일 해상도에서 일부 UI 겹침 |

**단계별 기록**

각 스텝의 스크린샷 + AI 인식 결과 + 액션 확인 가능

### 8.3 리포트 내보내기

- **HTML 내보내기**: 스타일이 적용된 웹 리포트 (공유/보관용)
- **JSON 내보내기**: 원시 데이터 (다른 시스템 연동용)

### 8.4 리포트 삭제

리포트 목록에서 삭제 버튼 클릭 → 확인 → 영구 삭제

---

## 9. 대시보드 사용 가이드

**Dashboard** 탭에서 전체 테스트 실행 기록과 통계를 확인합니다.

### 9.1 주요 지표

| 지표 | 설명 |
|------|------|
| **총 실행 수** | 지금까지 실행한 전체 테스트 수 |
| **평균 통과율** | 모든 테스트의 평균 성공률 |
| **발견된 버그** | 누적 버그 발견 건수 |
| **최근 리스크 추이** | 시간에 따른 리스크 레벨 변화 |

### 9.2 실행 기록 목록

각 실행마다:
- 실행 시각
- 대상 URL
- 통과율 / 총 스텝 수
- 리스크 레벨
- 상세 클릭 시 해당 리포트로 이동

---

## 10. Google Sheets 연동 설정

테스트 케이스를 Google 스프레드시트에 직접 저장하거나 불러올 수 있습니다.

### 10.1 Google Cloud 설정 (최초 1회)

1. [console.cloud.google.com](https://console.cloud.google.com) 접속
2. 새 프로젝트 생성 (또는 기존 프로젝트 사용)
3. **APIs & Services** → **Enable APIs** → `Google Sheets API` 활성화
4. **Credentials** → **Create Credentials** → **OAuth client ID**
5. Application type: **Desktop app**
6. 생성된 `Client ID`와 `Client Secret` 복사

### 10.2 Refresh Token 발급

```bash
# .env에 GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET 설정 후 실행
npx ts-node scripts/get-google-token.ts
```

브라우저가 열리면 Google 계정으로 로그인 → 권한 허용 → 터미널에 출력된 `GOOGLE_REFRESH_TOKEN` 복사 → `.env`에 추가

### 10.3 스프레드시트 ID 확인

```
https://docs.google.com/spreadsheets/d/[여기가 SHEET_ID]/edit
```

### 10.4 전체 사용 흐름

```
1. Auto Agent 페이지에서 시트 ID 입력
         │
         ▼
2. 탭 자동 로드 → 탭 선택
         │
         ├─ [선택] 📊 시트 양식 분석 클릭
         │         └─ 헤더 행 자동 탐지
         │            컬럼 이름·샘플값 분석
         │            감지된 컬럼 배지 표시
         │
         ▼
3. 테스트 케이스 생성
   → 시트 양식 분석을 했다면: 시트의 컬럼 형식에 맞게 생성
   → 파일을 업로드했다면: 파일 컬럼 형식에 맞게 생성
   → 아무것도 없다면: 표준 형식으로 생성
         │
         ▼
4. 📤 Google 시트에 내보내기
   → 분석 미완료 시: 자동으로 분석 먼저 실행
   → 기존 데이터 아래에 행 삽입 (기존 내용 보존)
```

### 10.5 지원 기능 요약

| 기능 | 설명 |
|------|------|
| **시트 양식 분석** | 헤더 행 자동 탐지, 컬럼별 샘플값 수집, 매핑 결과 표시 |
| **양식 맞춤 생성** | Google Sheets 또는 업로드 파일의 컬럼/언어/값 형식에 맞게 GPT 생성 |
| **내보내기** | 기존 데이터 아래에만 삽입, 기존 행 절대 삭제 안 함 |
| **자동 분석** | 내보내기 클릭 시 미분석 상태면 자동으로 분석 후 진행 |
| **불러오기** | 시트에서 기존 케이스 가져와 앱 내에서 상태 관리 |
| **파일 지원** | `.xlsx` · `.csv` · `.tsv` · `.json` 업로드 시 컬럼 자동 감지 |

### 10.6 헤더 자동 인식 (한/영 모두 지원)

시트 컬럼명이 한국어·영어 모두 자동 인식됩니다:

| 컬럼 종류 | 인식되는 이름 예시 |
|-----------|-------------------|
| ID | `번호`, `#`, `케이스ID`, `Test ID` |
| 제목 | `제목`, `테스트명`, `시나리오`, `Title`, `Test Case` |
| 단계 | `단계`, `실행방법`, `테스트단계`, `Steps` |
| 기대결과 | `기대결과`, `예상결과`, `Expected Result` |
| 우선순위 | `우선순위`, `중요도`, `Priority` |
| 상태 | `상태`, `결과`, `판정`, `Status`, `Pass/Fail` |

---

## 11. 환경변수 완전 가이드

### 11.1 필수 변수

| 변수 | 설명 | 예시 |
|------|------|------|
| `OPENAI_API_KEY` | OpenAI API 키. GPT-4o (플래닝/비전), GPT-4o-mini (검증)에 사용 | `sk-proj-...` |
| `DATABASE_URL` | 데이터베이스 연결 주소. 로컬: SQLite, 배포: PostgreSQL | `file:./prisma/dev.db` |
| `NEXT_PUBLIC_APP_URL` | 앱의 공개 URL. 절대 경로 필요 | `http://localhost:3000` |

### 11.2 선택 변수

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `AI_PROVIDER` | `openai` | `openai` 또는 `claude` |
| `ANTHROPIC_API_KEY` | — | Claude 사용 시 필요 |
| `PLAYWRIGHT_HEADLESS` | `true` | `false`로 설정 시 브라우저 창이 실제로 열림 (디버깅용) |
| `PLAYWRIGHT_SLOW_MO` | `0` | 액션 간 지연 시간(ms). `500` 설정 시 동작을 눈으로 확인 가능 |
| `NODE_ENV` | `development` | 배포 시 `production` |
| `TARGET_SCORE` | `80` | 자동 개선 목표 점수 (0-100) |
| `IMPROVE_MAX_ITERATIONS` | `10` | 자동 개선 최대 반복 횟수 |

### 11.3 DATABASE_URL 형식

**로컬 개발 (SQLite):**
```
DATABASE_URL="file:./prisma/dev.db"
```

**Render 배포 (PostgreSQL):**
```
DATABASE_URL="postgresql://user:password@host:5432/dbname"
```

> Render의 PostgreSQL Internal URL을 그대로 복사해서 사용하면 됩니다.

---

## 12. 프로젝트 구조

```
QA_APP/
├── app/                          # Next.js App Router 페이지
│   ├── layout.tsx                # 전체 레이아웃 + 상단 네비게이션
│   ├── page.tsx                  # 루트 → /human-agent 리다이렉트
│   ├── human-agent/              # Auto Agent 페이지 (메인)
│   │   └── page.tsx
│   ├── chat/                     # Chat QA 페이지
│   │   └── page.tsx
│   ├── reports/                  # 리포트 목록/상세 페이지
│   │   └── page.tsx
│   ├── dashboard/                # 대시보드 페이지
│   │   └── page.tsx
│   └── api/                      # 서버 API 엔드포인트
│       ├── human-agent/
│       │   ├── run/              # Auto Agent 실행 (SSE 스트리밍)
│       │   ├── generate/         # 테스트 케이스 생성
│       │   └── logout/           # 세션 종료
│       ├── reports/
│       │   └── save/             # 리포트 저장/조회/삭제 (PostgreSQL)
│       ├── google-sheets/        # Google Sheets 읽기/쓰기
│       ├── screenshots/          # 스크린샷 파일 서빙
│       ├── runs/                 # 테스트 실행 기록
│       └── config/provider/      # AI 제공자 설정
│
├── lib/                          # 핵심 비즈니스 로직
│   ├── ai/
│   │   ├── openai.ts             # GPT-4o 클라이언트 (플래닝 + 비전)
│   │   ├── claude.ts             # Claude 클라이언트 (선택적 사용)
│   │   └── prompts.ts            # AI 시스템 프롬프트
│   ├── human-agent/
│   │   ├── runner.ts             # Auto Agent v4 핵심 엔진
│   │   │                         #   CDP A11y 트리 추출
│   │   │                         #   GPT-4o 비전 + 플래닝
│   │   │                         #   Playwright 실행 (다중 전략)
│   │   │                         #   GPT-4o-mini 검증
│   │   ├── report-generator.ts   # GPT-4o 리포트 생성
│   │   └── report-export.ts      # HTML/JSON 내보내기
│   ├── db/
│   │   ├── client.ts             # Prisma 싱글톤 클라이언트
│   │   ├── reports.ts            # 리포트 CRUD (PostgreSQL)
│   │   └── history.ts            # 실행 기록 저장
│   ├── agent/                    # Auto Agent (코드 보존, UI에서 숨김)
│   │   ├── explorer/             # 사이트 자동 탐색
│   │   ├── scenario-gen/         # AI 시나리오 생성
│   │   ├── runner/               # 오케스트레이터
│   │   └── reporter/             # 리포트 생성
│   ├── qa/
│   │   ├── runner.ts             # Playwright 실행 엔진
│   │   └── selector.ts           # 다중 전략 셀렉터 리졸버
│   └── google-sheets/
│       └── index.ts              # Google Sheets API 클라이언트
│
├── prisma/
│   ├── schema.prisma             # DB 스키마 정의
│   └── dev.db                    # 로컬 SQLite 파일 (gitignore)
│
├── scripts/
│   ├── get-google-token.ts       # Google OAuth2 토큰 발급 (1회)
│   ├── run-human-agent-test.ts   # Auto Agent E2E 테스트
│   └── evaluate.ts               # QA 품질 평가
│
├── public/
│   └── screenshots/              # 테스트 스크린샷 저장 위치
│
├── Dockerfile                    # Render 배포용 Docker 이미지
├── .env                          # 환경변수 (gitignore에 포함)
└── package.json
```

---

## 13. 스코어링 시스템

Auto Agent (자동 파이프라인) 실행 후 0~100점 QA 점수를 산출합니다.

| 항목 | 비중 | 측정 기준 |
|------|------|----------|
| **QA Quality** | 40% | 시나리오 커버리지, assertion 커버율, 셀렉터 품질 |
| **Exec Reliability** | 20% | 셀렉터 오류율, 타이밍 실패, 재시도 없이 통과율 |
| **AI Quality** | 20% | 시나리오 명확성, 엣지케이스 포함 여부 |
| **Code Quality** | 10% | TypeScript 타입, 에러 핸들링, 로깅 품질 |
| **Performance** | 10% | 평균 시나리오 실행 시간 |

### 점수 해석

| 점수 | 의미 |
|------|------|
| 90~100 | 매우 우수 — 프로덕션 준비 완료 |
| 70~89 | 양호 — 일부 개선 권장 |
| 50~69 | 보통 — 주요 문제 수정 필요 |
| 0~49 | 미흡 — 전반적인 검토 필요 |

---

## 14. 트러블슈팅

### 리포트 저장 실패

**증상**: "저장 실패" 오류 메시지

**원인 1**: PostgreSQL 테이블 미생성
```bash
# Render 배포 로그에서 확인
# "✔ Your database is now in sync" 없으면 prisma db push 미실행
```

**해결**: Render 대시보드에서 수동 재배포 트리거 또는 `npm start` 확인

**원인 2**: `DATABASE_URL` 환경변수 미설정
```
# Render → Environment 탭에서 DATABASE_URL 확인
```

---

### AI가 버튼을 못 찾는 경우

**증상**: "버튼을 찾을 수 없습니다" 또는 같은 스텝 반복

**해결책 1**: 목표를 더 구체적으로 작성
```
❌ "버튼 클릭"
✅ "오른쪽 하단의 채팅 시작 버튼을 클릭"
```

**해결책 2**: 최대 스텝 수 늘리기 (복잡한 UI는 30~40 권장)

**해결책 3**: iframe이 있는 경우 (채팅 위젯 등) — Auto Agent v4는 CDP로 iframe도 지원

---

### 로컬에서 브라우저가 안 열리는 경우

```bash
# Playwright 브라우저 재설치
npx playwright install chromium

# 의존성 설치 (Linux/Mac)
npx playwright install-deps chromium
```

---

### 로컬 DB 초기화

```bash
# 테이블 삭제 후 재생성
npx prisma db push --force-reset
```

> ⚠️ 기존 데이터가 모두 삭제됩니다.

---

### `DATABASE_URL` 환경변수 오류 (배포 시)

**증상**: `Error: Environment variable not found: DATABASE_URL`

**원인**: Docker 빌드 단계에서는 환경변수가 없음. `prisma db push`를 시작 스크립트로 이동했는지 확인.

**package.json 확인:**
```json
{
  "scripts": {
    "build": "next build",
    "start": "prisma db push --accept-data-loss && next start -p ${PORT:-3000}"
  }
}
```

---

## 기술 스택

| 영역 | 기술 |
|------|------|
| **프레임워크** | Next.js 14 (App Router) |
| **언어** | TypeScript 5 |
| **AI — 플래닝/비전** | OpenAI GPT-4o |
| **AI — 검증** | OpenAI GPT-4o-mini |
| **AI — Claude 옵션** | Anthropic Claude (선택) |
| **브라우저 자동화** | Playwright 1.44 (Chromium + CDP) |
| **데이터베이스** | Prisma 5 + PostgreSQL (배포) / SQLite (개발) |
| **스타일링** | Tailwind CSS 3 |
| **로깅** | Pino 9 |
| **스프레드시트** | Google Sheets API v4 (OAuth2) |
| **배포** | Render (Docker) |

---

## 라이선스

MIT
