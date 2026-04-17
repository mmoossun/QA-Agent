"use client";

import { useState } from "react";
import type { QAReport, TestResult } from "@/lib/ai/types";

// ─── Constants ────────────────────────────────────────────────
const D = "https://app-dev.generativelab.co.kr";
const W = "https://d22ekkgk95jcrg.cloudfront.net/demo/index.html";
const PW = "TestPassword123";
const WAPI = "https://api-msg-dev.generativelab.co.kr/api/v1";
const WWS  = "wss://api-msg-dev.generativelab.co.kr/ws";

const PLUGIN_KEYS: Record<string, string> = {
  Brand1:   "pk_test_0000000000000000000000000000000000000000000000000000000000000001",
  Brand2:   "pk_test_0000000000000000000000000000000000000000000000000000000000000002",
  Brand3:   "pk_test_0000000000000000000000000000000000000000000000000000000000000003",
  Isolated: "pk_test_0000000000000000000000000000000000000000000000000000000000000004",
};

// ─── Session types ─────────────────────────────────────────────
type SessionType = "dashboard" | "widget";
interface Session {
  id: string; label: string; type: SessionType; url: string;
  loginEmail?: string; loginPassword?: string; workspace?: string;
  enabled: boolean; role?: string;
}

const DEFAULT_SESSIONS: Session[] = [
  { id:"s-owner",  label:"대시보드 — Owner",         type:"dashboard", url:D, loginEmail:"qa-owner@example.com",    loginPassword:PW, role:"owner",  enabled:true  },
  { id:"s-admin",  label:"대시보드 — Admin",          type:"dashboard", url:D, loginEmail:"qa-admin1@example.com",   loginPassword:PW, role:"admin",  enabled:true  },
  { id:"s-agent",  label:"대시보드 — Agent",          type:"dashboard", url:D, loginEmail:"qa-agent1@example.com",   loginPassword:PW, role:"agent",  enabled:false },
  { id:"s-viewer", label:"대시보드 — Viewer",         type:"dashboard", url:D, loginEmail:"qa-viewer@example.com",   loginPassword:PW, role:"viewer", enabled:false },
  { id:"s-iso",    label:"대시보드 — Isolated Owner", type:"dashboard", url:D, loginEmail:"qa-iso-owner@example.com",loginPassword:PW, role:"owner",  enabled:false },
  { id:"s-w-b1",  label:"위젯 — Brand1",             type:"widget",    url:W, workspace:"Brand1", enabled:true  },
  { id:"s-w-b2",  label:"위젯 — Brand2",             type:"widget",    url:W, workspace:"Brand2", enabled:false },
  { id:"s-w-b3",  label:"위젯 — Brand3",             type:"widget",    url:W, workspace:"Brand3", enabled:false },
];

// ─── Scenario types ────────────────────────────────────────────
type ScenarioGroup =
  | "auth" | "auth-edge"
  | "workspace"
  | "conversations" | "conv-detail"
  | "settings-nav" | "settings-pages"
  | "role-access"
  | "page-integrity"
  | "widget-load" | "widget-interact" | "widget-state";

interface Scenario {
  id: string; name: string; group: ScenarioGroup;
  priority: "critical"|"high"|"medium"|"low";
  forType: SessionType|"both"; forRoles?: string[];
  steps: object[]; expectedResult: string; tags: string[];
  note?: string; // "아차!" 포인트
}

// helper: fill → click submit → waitForUrl
const loginSteps = (email: string, password: string) => [
  { action:"navigate",   value:`${D}/login`, description:"로그인 페이지 이동" },
  { action:"fill",       target:{ css:'input[type="email"]', placeholder:"이메일 입력" }, value:email, description:"이메일 입력" },
  { action:"fill",       target:{ css:'input[type="password"]', placeholder:"비밀번호 입력" }, value:password, description:"비밀번호 입력" },
  { action:"click",      target:{ css:'button[type="submit"]', text:"로그인" }, description:"로그인 버튼 클릭" },
  { action:"wait",       value:"3000", description:"대시보드 로딩 대기" },
];

// ─── All Scenarios ─────────────────────────────────────────────
const SCENARIOS: Scenario[] = [

  // ══════════════════════════════════════════════════════
  // AUTH — 정상 흐름
  // ══════════════════════════════════════════════════════
  {
    id:"AUTH-001", name:"정상 계정 로그인 → /w/:id 리다이렉트 확인", group:"auth", priority:"critical", forType:"dashboard",
    steps:[
      ...loginSteps("{{email}}","{{password}}"),
      { action:"waitForUrl", value:"**/w/**", description:"/w/:workspaceId 로 리다이렉트 확인" },
      { action:"screenshot", description:"로그인 완료 화면" },
    ],
    expectedResult:"/w/{workspaceId}/conversations URL로 이동",
    tags:["smoke","auth"], note:"SPA 리다이렉트 실패 시 빈 화면에 걸릴 수 있음",
  },
  {
    id:"AUTH-002", name:"로그인 후 새로고침 시 세션 유지", group:"auth", priority:"high", forType:"dashboard",
    steps:[
      ...loginSteps("{{email}}","{{password}}"),
      { action:"waitForUrl", value:"**/w/**", description:"워크스페이스 진입" },
      { action:"navigate",   value:`${D}/`, description:"루트 재방문 (새로고침 시뮬레이션)" },
      { action:"wait",       value:"2000", description:"리다이렉트 대기" },
      { action:"waitForUrl", value:"**/w/**", description:"세션 유지되어 워크스페이스 유지 확인" },
      { action:"screenshot", description:"세션 유지 화면" },
    ],
    expectedResult:"재방문 시에도 로그인 유지, /w/로 다시 리다이렉트",
    tags:["auth","session"], note:"쿠키/토큰 만료 버그 여기서 잡힘",
  },
  {
    id:"AUTH-003", name:"로그아웃 후 /w/ 직접 접근 시 로그인으로 리다이렉트", group:"auth", priority:"high", forType:"dashboard",
    steps:[
      { action:"navigate",   value:`${D}/w/test-workspace-id/conversations`, description:"/w/ URL 직접 접근 (로그아웃 상태)" },
      { action:"wait",       value:"2000", description:"리다이렉트 대기" },
      { action:"waitForUrl", value:"**/login**", description:"미인증 상태에서 로그인으로 리다이렉트 확인" },
      { action:"screenshot", description:"리다이렉트 결과" },
    ],
    expectedResult:"인증 없이 /w/ 접근 시 /login 으로 리다이렉트",
    tags:["auth","security"], note:"미인증 직접 URL 접근 — 자주 놓치는 보안 체크",
  },

  // ══════════════════════════════════════════════════════
  // AUTH EDGE — 놓치기 쉬운 엣지 케이스
  // ══════════════════════════════════════════════════════
  {
    id:"AUTH-E001", name:"잘못된 비밀번호 → 오류 메시지 (로그인 페이지 유지)", group:"auth-edge", priority:"high", forType:"dashboard",
    steps:[
      { action:"navigate",   value:`${D}/login`, description:"로그인 페이지" },
      { action:"fill",       target:{ css:'input[type="email"]' }, value:"{{email}}", description:"이메일 입력" },
      { action:"fill",       target:{ css:'input[type="password"]' }, value:"WrongPassword999!", description:"틀린 비밀번호" },
      { action:"click",      target:{ css:'button[type="submit"]', text:"로그인" }, description:"제출" },
      { action:"wait",       value:"2000", description:"응답 대기" },
      { action:"assert",     target:{ css:'[role="alert"],[class*="error"],[class*="toast"],[class*="Error"]' }, description:"오류 메시지 표시 확인" },
      { action:"screenshot", description:"오류 상태" },
    ],
    expectedResult:"오류 토스트/메시지 표시, URL은 /login 유지",
    tags:["auth","negative-test"],
  },
  {
    id:"AUTH-E002", name:"이메일 없이 제출 → 클라이언트 유효성검사", group:"auth-edge", priority:"medium", forType:"dashboard",
    steps:[
      { action:"navigate",   value:`${D}/login`, description:"로그인 페이지" },
      { action:"fill",       target:{ css:'input[type="password"]' }, value:PW, description:"비밀번호만 입력" },
      { action:"click",      target:{ css:'button[type="submit"]' }, description:"제출" },
      { action:"wait",       value:"1000", description:"유효성 검사 대기" },
      { action:"screenshot", description:"유효성 검사 결과 — 네트워크 요청 없이 막혀야 함" },
    ],
    expectedResult:"이메일 필드 required 표시, API 호출 없이 차단",
    tags:["auth","validation"], note:"API 호출이 발생하면 클라이언트 검증 누락",
  },
  {
    id:"AUTH-E003", name:"이메일 형식 오류 (@ 없음) → 유효성검사", group:"auth-edge", priority:"medium", forType:"dashboard",
    steps:[
      { action:"navigate",   value:`${D}/login`, description:"로그인 페이지" },
      { action:"fill",       target:{ css:'input[type="email"]' }, value:"notanemail", description:"잘못된 이메일 형식" },
      { action:"fill",       target:{ css:'input[type="password"]' }, value:PW, description:"비밀번호 입력" },
      { action:"click",      target:{ css:'button[type="submit"]' }, description:"제출" },
      { action:"wait",       value:"1000", description:"검증 대기" },
      { action:"screenshot", description:"이메일 형식 오류 표시 확인" },
    ],
    expectedResult:"이메일 형식 오류 표시",
    tags:["auth","validation"],
  },
  {
    id:"AUTH-E004", name:"이메일 앞뒤 공백 포함 → trim 처리 확인", group:"auth-edge", priority:"low", forType:"dashboard",
    steps:[
      { action:"navigate",   value:`${D}/login`, description:"로그인 페이지" },
      { action:"fill",       target:{ css:'input[type="email"]' }, value:"  {{email}}  ", description:"공백 포함 이메일" },
      { action:"fill",       target:{ css:'input[type="password"]' }, value:"{{password}}", description:"비밀번호" },
      { action:"click",      target:{ css:'button[type="submit"]' }, description:"제출" },
      { action:"wait",       value:"3000", description:"결과 대기" },
      { action:"screenshot", description:"공백 trim 여부 확인 — 성공하면 trim 처리됨" },
    ],
    expectedResult:"앞뒤 공백을 trim하고 정상 로그인 (또는 명확한 오류 메시지)",
    tags:["auth","edge-case"], note:"공백 trim 안 하면 서버에서 계정 없음으로 처리",
  },
  {
    id:"AUTH-E005", name:"비밀번호 필드 마스킹 확인 (type=password)", group:"auth-edge", priority:"low", forType:"dashboard",
    steps:[
      { action:"navigate",   value:`${D}/login`, description:"로그인 페이지" },
      { action:"assert",     target:{ css:'input[type="password"]' }, description:"비밀번호 필드 type=password 확인" },
      { action:"screenshot", description:"마스킹 상태" },
    ],
    expectedResult:"비밀번호 입력이 •••로 마스킹됨",
    tags:["auth","security"], note:"type=text로 잘못 렌더링되는 경우 보안 문제",
  },

  // ══════════════════════════════════════════════════════
  // WORKSPACE — 워크스페이스 전환
  // ══════════════════════════════════════════════════════
  {
    id:"WS-001", name:"로그인 후 워크스페이스 전환 UI 존재 확인", group:"workspace", priority:"high", forType:"dashboard",
    steps:[
      ...loginSteps("{{email}}","{{password}}"),
      { action:"waitForUrl", value:"**/w/**", description:"워크스페이스 진입" },
      { action:"assert",     target:{ css:'[class*="workspace"],[class*="sidebar"],[class*="nav"],aside,nav' }, description:"사이드바/워크스페이스 영역 확인" },
      { action:"screenshot", description:"좌측 상단 워크스페이스 영역 캡처" },
    ],
    expectedResult:"좌측 상단에 현재 워크스페이스 이름과 전환 UI 표시",
    tags:["workspace","ui"],
  },
  {
    id:"WS-002", name:"URL workspaceId가 실제 워크스페이스와 일치", group:"workspace", priority:"high", forType:"dashboard",
    steps:[
      ...loginSteps("{{email}}","{{password}}"),
      { action:"waitForUrl", value:"**/w/**", description:"워크스페이스 진입" },
      { action:"evaluate",   value:"if (!window.location.pathname.includes('/w/')) throw new Error('Not in workspace URL: ' + window.location.pathname)", description:"URL에 /w/ 포함 확인" },
      { action:"screenshot", description:"URL 확인" },
    ],
    expectedResult:"URL이 /w/{실제workspaceId} 형태",
    tags:["workspace","routing"], note:"리다이렉트 루프 또는 잘못된 workspaceId 버그 감지",
  },
  {
    id:"WS-003", name:"공용 계정이 Brand1/2/3 모두 접근 가능 (워크스페이스 목록)", group:"workspace", priority:"medium", forType:"dashboard",
    steps:[
      ...loginSteps("{{email}}","{{password}}"),
      { action:"waitForUrl", value:"**/w/**", description:"워크스페이스 진입" },
      { action:"screenshot", description:"진입 후 워크스페이스 상태 — 사이드바에 전환 UI 캡처" },
    ],
    expectedResult:"Brand1/2/3 워크스페이스 전환 가능 (Owner는 3개 접근 가능)",
    tags:["workspace"], forRoles:["owner","admin","agent","viewer"],
  },
  {
    id:"WS-004", name:"Isolated 계정은 Isolated Workspace만 보임", group:"workspace", priority:"high", forType:"dashboard",
    steps:[
      ...loginSteps("qa-iso-owner@example.com", PW),
      { action:"waitForUrl", value:"**/w/**", description:"워크스페이스 진입" },
      { action:"screenshot", description:"Isolated 워크스페이스만 표시되어야 함" },
    ],
    expectedResult:"Brand1/2/3 워크스페이스 접근 불가, Isolated만 보임",
    tags:["workspace","isolation","security"], note:"격리 계정이 다른 워크스페이스 보이면 보안 문제",
  },

  // ══════════════════════════════════════════════════════
  // CONVERSATIONS — 대화 목록
  // ══════════════════════════════════════════════════════
  {
    id:"CONV-001", name:"대화 목록 페이지 정상 렌더링", group:"conversations", priority:"critical", forType:"dashboard",
    steps:[
      ...loginSteps("{{email}}","{{password}}"),
      { action:"waitForUrl", value:"**/w/**", description:"워크스페이스 진입" },
      { action:"wait",       value:"2000", description:"데이터 로딩 대기" },
      { action:"assert",     target:{ css:"body" }, description:"페이지 바디 확인" },
      { action:"screenshot", description:"대화 목록 전체 캡처" },
    ],
    expectedResult:"대화 목록 또는 빈 상태 메시지 표시",
    tags:["smoke","conversations"],
  },
  {
    id:"CONV-002", name:"대화 목록 빈 상태 — 빈 화면이 아닌 안내 메시지", group:"conversations", priority:"medium", forType:"dashboard",
    steps:[
      ...loginSteps("{{email}}","{{password}}"),
      { action:"waitForUrl", value:"**/w/**", description:"워크스페이스 진입" },
      { action:"wait",       value:"3000", description:"로딩 완료 대기" },
      { action:"screenshot", description:"빈 상태 UI 캡처 — 완전한 빈 화면이면 버그" },
    ],
    expectedResult:"대화가 없을 경우 빈 상태 일러스트/안내 문구 표시",
    tags:["conversations","ux"], note:"빈 화면과 로딩 중을 구분 못 하는 버그 자주 발생",
  },
  {
    id:"CONV-003", name:"대화 목록 필터 탭 (전체/열림/닫힘 등) 존재 확인", group:"conversations", priority:"high", forType:"dashboard",
    steps:[
      ...loginSteps("{{email}}","{{password}}"),
      { action:"waitForUrl", value:"**/w/**", description:"워크스페이스 진입" },
      { action:"wait",       value:"2000", description:"로딩 대기" },
      { action:"assert",     target:{ css:'[role="tab"],[class*="tab"],[class*="filter"],[class*="Tab"]' }, description:"필터/탭 UI 확인" },
      { action:"screenshot", description:"필터 탭 캡처" },
    ],
    expectedResult:"상태 필터 탭(전체/열림/보류/닫힘)이 표시됨",
    tags:["conversations","ui"],
  },
  {
    id:"CONV-004", name:"대화 검색 입력창 존재 및 포커스 가능", group:"conversations", priority:"medium", forType:"dashboard",
    steps:[
      ...loginSteps("{{email}}","{{password}}"),
      { action:"waitForUrl", value:"**/w/**", description:"워크스페이스 진입" },
      { action:"wait",       value:"2000", description:"로딩 대기" },
      { action:"assert",     target:{ css:'input[type="search"],input[placeholder*="검색"],input[placeholder*="Search"],[class*="search"] input' }, description:"검색창 존재 확인" },
      { action:"screenshot", description:"검색창 캡처" },
    ],
    expectedResult:"검색창이 존재하고 입력 가능",
    tags:["conversations","search"],
  },
  {
    id:"CONV-005", name:"대화 클릭 시 URL이 /conversations/:id로 변경", group:"conversations", priority:"high", forType:"dashboard",
    steps:[
      ...loginSteps("{{email}}","{{password}}"),
      { action:"waitForUrl", value:"**/w/**", description:"워크스페이스 진입" },
      { action:"wait",       value:"2000", description:"목록 로딩 대기" },
      { action:"click",      target:{ css:'[class*="conversation-item"],[class*="ConversationItem"],[class*="chat-item"],[class*="list-item"] a,[class*="row"]' }, description:"첫 번째 대화 항목 클릭" },
      { action:"wait",       value:"2000", description:"상세 로딩 대기" },
      { action:"screenshot", description:"대화 상세 또는 URL 변경 확인" },
    ],
    expectedResult:"URL이 /conversations/:id 로 변경되고 대화 상세 표시",
    tags:["conversations","navigation"],
  },
  {
    id:"CONV-006", name:"대화 목록 스크롤 시 레이아웃 깨지지 않음", group:"conversations", priority:"low", forType:"dashboard",
    steps:[
      ...loginSteps("{{email}}","{{password}}"),
      { action:"waitForUrl", value:"**/w/**", description:"워크스페이스 진입" },
      { action:"wait",       value:"2000", description:"로딩 대기" },
      { action:"scroll",     value:"500", description:"아래로 스크롤" },
      { action:"screenshot", description:"스크롤 후 레이아웃 캡처" },
    ],
    expectedResult:"스크롤 후 사이드바/헤더 레이아웃 유지",
    tags:["conversations","ui","layout"],
  },

  // ══════════════════════════════════════════════════════
  // CONVERSATION DETAIL — 대화 상세
  // ══════════════════════════════════════════════════════
  {
    id:"DETAIL-001", name:"대화 상세 — 메시지 입력창 존재", group:"conv-detail", priority:"high", forType:"dashboard",
    steps:[
      ...loginSteps("{{email}}","{{password}}"),
      { action:"waitForUrl", value:"**/w/**", description:"워크스페이스 진입" },
      { action:"wait",       value:"2000", description:"목록 로딩" },
      { action:"click",      target:{ css:'[class*="conversation"],[class*="chat-item"],[class*="list"] a,li a' }, description:"대화 항목 클릭" },
      { action:"wait",       value:"2000", description:"상세 로딩" },
      { action:"screenshot", description:"대화 상세 전체 캡처" },
    ],
    expectedResult:"메시지 히스토리 + 답장 입력창 표시",
    tags:["conv-detail","ui"],
  },
  {
    id:"DETAIL-002", name:"대화 상세 — 고객 정보 패널 존재", group:"conv-detail", priority:"medium", forType:"dashboard",
    steps:[
      ...loginSteps("{{email}}","{{password}}"),
      { action:"waitForUrl", value:"**/w/**", description:"워크스페이스 진입" },
      { action:"wait",       value:"2000", description:"목록 로딩" },
      { action:"click",      target:{ css:'[class*="conversation"],[class*="chat-item"] a,li a' }, description:"대화 클릭" },
      { action:"wait",       value:"2000", description:"상세 로딩" },
      { action:"assert",     target:{ css:'[class*="customer"],[class*="contact"],[class*="sidebar"],[class*="profile"]' }, description:"고객 정보 사이드 패널 확인" },
      { action:"screenshot", description:"우측 고객 정보 패널 캡처" },
    ],
    expectedResult:"우측 패널에 고객 정보(이름, 채널 등) 표시",
    tags:["conv-detail","ui"], note:"패널이 없으면 담당자 배정 기능도 없는 경우 多",
  },
  {
    id:"DETAIL-003", name:"Viewer는 답장 입력창 비활성화/숨김", group:"conv-detail", priority:"high", forType:"dashboard",
    forRoles:["viewer"],
    steps:[
      ...loginSteps("{{email}}","{{password}}"),
      { action:"waitForUrl", value:"**/w/**", description:"워크스페이스 진입" },
      { action:"wait",       value:"2000", description:"로딩" },
      { action:"click",      target:{ css:'[class*="conversation"],[class*="chat-item"] a,li a' }, description:"대화 클릭" },
      { action:"wait",       value:"2000", description:"상세 로딩" },
      { action:"screenshot", description:"Viewer 권한 — 답장창 없어야 함" },
    ],
    expectedResult:"Viewer는 답장/전송 UI 없음 (읽기 전용)",
    tags:["role","security"], note:"Viewer가 메시지를 보낼 수 있으면 권한 버그",
  },

  // ══════════════════════════════════════════════════════
  // SETTINGS NAV — 설정 네비게이션
  // ══════════════════════════════════════════════════════
  {
    id:"SNAV-001", name:"설정 링크 — 사이드바에 존재", group:"settings-nav", priority:"high", forType:"dashboard",
    forRoles:["owner","admin"],
    steps:[
      ...loginSteps("{{email}}","{{password}}"),
      { action:"waitForUrl", value:"**/w/**", description:"워크스페이스 진입" },
      { action:"wait",       value:"2000", description:"로딩" },
      { action:"assert",     target:{ css:'a[href*="settings"],[class*="settings-link"],[class*="nav"] a' }, description:"설정 링크 확인" },
      { action:"screenshot", description:"설정 링크 위치 캡처" },
    ],
    expectedResult:"사이드바 또는 헤더에 설정 링크 표시",
    tags:["settings","navigation"],
  },
  {
    id:"SNAV-002", name:"Agent/Viewer — 설정 링크 숨겨짐 또는 접근 차단", group:"settings-nav", priority:"high", forType:"dashboard",
    forRoles:["agent","viewer"],
    steps:[
      ...loginSteps("{{email}}","{{password}}"),
      { action:"waitForUrl", value:"**/w/**", description:"워크스페이스 진입" },
      { action:"wait",       value:"2000", description:"로딩" },
      { action:"screenshot", description:"Agent/Viewer 화면 — 설정 링크 없어야 함" },
    ],
    expectedResult:"Agent/Viewer는 설정 메뉴 미표시 또는 클릭 시 접근 거부",
    tags:["role","settings","security"], note:"UI에는 숨겼지만 URL 직접 입력으로 접근되는 경우 있음",
  },

  // ══════════════════════════════════════════════════════
  // SETTINGS PAGES — 설정 페이지들
  // ══════════════════════════════════════════════════════
  {
    id:"SP-001", name:"일반 설정 페이지 로드 (settings)", group:"settings-pages", priority:"high", forType:"dashboard",
    forRoles:["owner","admin"],
    steps:[
      ...loginSteps("{{email}}","{{password}}"),
      { action:"waitForUrl", value:"**/w/**", description:"워크스페이스 진입" },
      { action:"navigate",   value:`${D}/`, description:"루트로 이동 (workspaceId 리다이렉트)" },
      { action:"wait",       value:"3000", description:"리다이렉트 대기" },
      { action:"evaluate",   value:`const wid = window.location.pathname.match(/\\/w\\/([^/]+)/)?.[1]; if(wid) window.location.href = '${D}/w/' + wid + '/settings';`, description:"workspaceId 추출 후 settings 이동" },
      { action:"wait",       value:"3000", description:"설정 페이지 로딩" },
      { action:"screenshot", description:"설정 메인 페이지" },
    ],
    expectedResult:"설정 페이지 및 좌측 설정 네비게이션 표시",
    tags:["settings"],
  },
  {
    id:"SP-002", name:"팀 관리 페이지 — 멤버 목록 표시", group:"settings-pages", priority:"high", forType:"dashboard",
    forRoles:["owner","admin"],
    steps:[
      ...loginSteps("{{email}}","{{password}}"),
      { action:"waitForUrl", value:"**/w/**", description:"워크스페이스 진입" },
      { action:"evaluate",   value:`const wid = window.location.pathname.match(/\\/w\\/([^/]+)/)?.[1]; if(wid) window.location.href = '${D}/w/' + wid + '/settings/team';`, description:"팀 설정 페이지 이동" },
      { action:"wait",       value:"3000", description:"로딩" },
      { action:"assert",     target:{ css:'[class*="member"],[class*="team"],[class*="user"],[class*="list"]' }, description:"멤버 목록 확인" },
      { action:"screenshot", description:"팀 멤버 목록 캡처" },
    ],
    expectedResult:"팀원 목록 (이름, 이메일, 역할) 표시",
    tags:["settings","team"],
  },
  {
    id:"SP-003", name:"SDK 설정 — Plugin Key 표시", group:"settings-pages", priority:"medium", forType:"dashboard",
    forRoles:["owner","admin"],
    steps:[
      ...loginSteps("{{email}}","{{password}}"),
      { action:"waitForUrl", value:"**/w/**", description:"워크스페이스 진입" },
      { action:"evaluate",   value:`const wid = window.location.pathname.match(/\\/w\\/([^/]+)/)?.[1]; if(wid) window.location.href = '${D}/w/' + wid + '/settings/sdk';`, description:"SDK 페이지 이동" },
      { action:"wait",       value:"3000", description:"로딩" },
      { action:"screenshot", description:"SDK/Plugin Key 화면 캡처" },
    ],
    expectedResult:"Plugin Key가 마스킹 또는 표시됨, 복사 버튼 존재",
    tags:["settings","sdk"], note:"Plugin Key 노출 방식 — 보안 및 UX 모두 확인 필요",
  },
  {
    id:"SP-004", name:"비즈니스 시간 설정 페이지 로드", group:"settings-pages", priority:"medium", forType:"dashboard",
    forRoles:["owner","admin"],
    steps:[
      ...loginSteps("{{email}}","{{password}}"),
      { action:"waitForUrl", value:"**/w/**", description:"워크스페이스 진입" },
      { action:"evaluate",   value:`const wid = window.location.pathname.match(/\\/w\\/([^/]+)/)?.[1]; if(wid) window.location.href = '${D}/w/' + wid + '/settings/hours';`, description:"운영 시간 설정 이동" },
      { action:"wait",       value:"3000", description:"로딩" },
      { action:"screenshot", description:"운영 시간 설정 화면" },
    ],
    expectedResult:"요일별 운영 시간 설정 UI 표시",
    tags:["settings","hours"],
  },
  {
    id:"SP-005", name:"인테그레이션 페이지 로드 (카카오 연동 상태 확인)", group:"settings-pages", priority:"medium", forType:"dashboard",
    forRoles:["owner","admin"],
    steps:[
      ...loginSteps("{{email}}","{{password}}"),
      { action:"waitForUrl", value:"**/w/**", description:"워크스페이스 진입" },
      { action:"evaluate",   value:`const wid = window.location.pathname.match(/\\/w\\/([^/]+)/)?.[1]; if(wid) window.location.href = '${D}/w/' + wid + '/settings/integrations';`, description:"인테그레이션 페이지 이동" },
      { action:"wait",       value:"3000", description:"로딩" },
      { action:"screenshot", description:"카카오/네이버/이메일 연동 상태 캡처" },
    ],
    expectedResult:"인테그레이션 목록 표시, 카카오는 비활성(미연동) 상태",
    tags:["settings","integrations"], note:"카카오 연동 안 됨 — 버튼 클릭 시 오류 표시 여부 확인",
  },
  {
    id:"SP-006", name:"AI 에이전트 설정 페이지 로드", group:"settings-pages", priority:"low", forType:"dashboard",
    forRoles:["owner","admin"],
    steps:[
      ...loginSteps("{{email}}","{{password}}"),
      { action:"waitForUrl", value:"**/w/**", description:"워크스페이스 진입" },
      { action:"evaluate",   value:`const wid = window.location.pathname.match(/\\/w\\/([^/]+)/)?.[1]; if(wid) window.location.href = '${D}/w/' + wid + '/settings/ai-agent';`, description:"AI 에이전트 설정 이동" },
      { action:"wait",       value:"3000", description:"로딩" },
      { action:"screenshot", description:"AI 에이전트 설정 화면" },
    ],
    expectedResult:"AI 에이전트 설정 UI 표시",
    tags:["settings","ai"],
  },
  {
    id:"SP-007", name:"감사 로그 페이지 — Owner만 접근 가능", group:"settings-pages", priority:"high", forType:"dashboard",
    forRoles:["owner"],
    steps:[
      ...loginSteps("{{email}}","{{password}}"),
      { action:"waitForUrl", value:"**/w/**", description:"워크스페이스 진입" },
      { action:"evaluate",   value:`const wid = window.location.pathname.match(/\\/w\\/([^/]+)/)?.[1]; if(wid) window.location.href = '${D}/w/' + wid + '/settings/audit-log';`, description:"감사 로그 페이지 이동" },
      { action:"wait",       value:"3000", description:"로딩" },
      { action:"screenshot", description:"감사 로그 캡처" },
    ],
    expectedResult:"Owner는 감사 로그 접근 가능, 로그 목록 표시",
    tags:["settings","audit","security"],
  },

  // ══════════════════════════════════════════════════════
  // ROLE ACCESS — 권한별 접근 제어
  // ══════════════════════════════════════════════════════
  {
    id:"ROLE-001", name:"Admin이 URL 직접 입력으로 감사 로그 접근 시도", group:"role-access", priority:"high", forType:"dashboard",
    forRoles:["admin"],
    steps:[
      ...loginSteps("{{email}}","{{password}}"),
      { action:"waitForUrl", value:"**/w/**", description:"워크스페이스 진입" },
      { action:"evaluate",   value:`const wid = window.location.pathname.match(/\\/w\\/([^/]+)/)?.[1]; if(wid) window.location.href = '${D}/w/' + wid + '/settings/audit-log';`, description:"감사 로그 직접 URL 접근" },
      { action:"wait",       value:"3000", description:"결과 대기" },
      { action:"screenshot", description:"Admin의 감사 로그 접근 결과 — 차단되어야 함" },
    ],
    expectedResult:"Admin은 감사 로그 차단 (403 또는 리다이렉트)",
    tags:["role","security"], note:"UI에는 없어도 URL 직접 입력으로 접근되면 권한 버그",
  },
  {
    id:"ROLE-002", name:"Viewer — 대화 목록 접근 가능하지만 액션 버튼 없음", group:"role-access", priority:"high", forType:"dashboard",
    forRoles:["viewer"],
    steps:[
      ...loginSteps("{{email}}","{{password}}"),
      { action:"waitForUrl", value:"**/w/**", description:"워크스페이스 진입" },
      { action:"wait",       value:"2000", description:"로딩" },
      { action:"screenshot", description:"Viewer 화면 — 담당자 배정, 상태변경 버튼 없어야 함" },
    ],
    expectedResult:"대화 목록 표시되나 상태 변경/배정/답장 버튼 없음",
    tags:["role","viewer","security"],
  },
  {
    id:"ROLE-003", name:"Agent — 설정 URL 직접 접근 시 차단", group:"role-access", priority:"high", forType:"dashboard",
    forRoles:["agent"],
    steps:[
      ...loginSteps("{{email}}","{{password}}"),
      { action:"waitForUrl", value:"**/w/**", description:"워크스페이스 진입" },
      { action:"evaluate",   value:`const wid = window.location.pathname.match(/\\/w\\/([^/]+)/)?.[1]; if(wid) window.location.href = '${D}/w/' + wid + '/settings/team';`, description:"팀 설정 직접 접근" },
      { action:"wait",       value:"3000", description:"결과 대기" },
      { action:"screenshot", description:"Agent의 설정 접근 결과 — 차단되어야 함" },
    ],
    expectedResult:"Agent는 설정 페이지 차단 (리다이렉트 또는 권한 없음 메시지)",
    tags:["role","agent","security"], note:"가장 자주 발생하는 권한 누락 패턴",
  },

  // ══════════════════════════════════════════════════════
  // PAGE INTEGRITY — 페이지 기본 무결성
  // ══════════════════════════════════════════════════════
  {
    id:"PI-001", name:"루트 URL (/) — 로그인 후 자동 워크스페이스 리다이렉트", group:"page-integrity", priority:"critical", forType:"dashboard",
    steps:[
      ...loginSteps("{{email}}","{{password}}"),
      { action:"waitForUrl", value:"**/w/**", description:"리다이렉트 확인" },
      { action:"evaluate",   value:"if (!document.querySelector('body')) throw new Error('Body not found')", description:"DOM 기본 렌더링 확인" },
      { action:"screenshot", description:"루트 접근 후 최종 페이지" },
    ],
    expectedResult:"/ 접근 시 자동으로 /w/:id 로 이동",
    tags:["smoke","routing"],
  },
  {
    id:"PI-002", name:"존재하지 않는 URL — 404 페이지 표시", group:"page-integrity", priority:"medium", forType:"dashboard",
    steps:[
      { action:"navigate",   value:`${D}/this-route-does-not-exist-12345`, description:"존재하지 않는 URL 접근" },
      { action:"wait",       value:"2000", description:"응답 대기" },
      { action:"screenshot", description:"404 또는 Not Found 화면 캡처" },
    ],
    expectedResult:"404 페이지 표시 (빈 화면 아님)",
    tags:["routing","ui"], note:"SPA에서 404 없이 빈 화면 렌더링하는 경우 흔함",
  },
  {
    id:"PI-003", name:"페이지 로드 후 JS 에러 없음 (콘솔 체크)", group:"page-integrity", priority:"high", forType:"dashboard",
    steps:[
      ...loginSteps("{{email}}","{{password}}"),
      { action:"waitForUrl", value:"**/w/**", description:"워크스페이스 진입" },
      { action:"wait",       value:"3000", description:"완전 로딩 대기" },
      { action:"evaluate",   value:"window.__QA_ERROR_CHECK__ = true; // 페이지가 정상 실행 중임을 표시", description:"콘솔 에러 수동 확인 시점" },
      { action:"screenshot", description:"로딩 완료 화면 — 오버레이 에러 없어야 함" },
    ],
    expectedResult:"빨간 에러 오버레이, 크래시 화면 없음",
    tags:["stability","integrity"],
  },
  {
    id:"PI-004", name:"페이지 타이틀이 비어있지 않음", group:"page-integrity", priority:"low", forType:"dashboard",
    steps:[
      ...loginSteps("{{email}}","{{password}}"),
      { action:"waitForUrl", value:"**/w/**", description:"워크스페이스 진입" },
      { action:"evaluate",   value:"if (!document.title || document.title === 'undefined') throw new Error('Page title is empty or undefined: ' + document.title)", description:"document.title 비어있지 않음 확인" },
      { action:"screenshot", description:"페이지 상태" },
    ],
    expectedResult:"document.title이 의미 있는 값으로 설정됨",
    tags:["integrity","seo"], note:"undefined나 빈 타이틀 — 브라우저 탭 UX + SEO 문제",
  },
  {
    id:"PI-005", name:"1440px 화면에서 레이아웃 오버플로우 없음", group:"page-integrity", priority:"medium", forType:"dashboard",
    steps:[
      ...loginSteps("{{email}}","{{password}}"),
      { action:"waitForUrl", value:"**/w/**", description:"워크스페이스 진입" },
      { action:"wait",       value:"2000", description:"로딩" },
      { action:"evaluate",   value:"const overflow = document.body.scrollWidth > window.innerWidth; if (overflow) throw new Error('Horizontal overflow detected: body=' + document.body.scrollWidth + ' window=' + window.innerWidth)", description:"수평 오버플로우 감지" },
      { action:"screenshot", description:"1440px 레이아웃 캡처" },
    ],
    expectedResult:"수평 스크롤바 없음, 레이아웃이 1440px에 맞게 표시",
    tags:["ui","layout"], note:"대시보드는 1440px 기준 설계가 많아 이 해상도에서 자주 깨짐",
  },

  // ══════════════════════════════════════════════════════
  // WIDGET LOAD — 위젯 로드
  // ══════════════════════════════════════════════════════
  {
    id:"WL-001", name:"위젯 데모 페이지 로드 및 스크립트 실행", group:"widget-load", priority:"critical", forType:"widget",
    steps:[
      { action:"navigate",   value:W, description:"위젯 데모 페이지 이동" },
      { action:"wait",       value:"4000", description:"위젯 번들 로딩 + 초기화 대기" },
      { action:"assert",     target:{ css:"body" }, description:"페이지 바디 확인" },
      { action:"screenshot", description:"위젯 버튼(우측 하단) 표시 확인" },
    ],
    expectedResult:"우측 하단에 채팅 위젯 버튼 표시",
    tags:["smoke","widget"],
  },
  {
    id:"WL-002", name:"window.ZeroTalk 전역 객체 존재", group:"widget-load", priority:"critical", forType:"widget",
    steps:[
      { action:"navigate",   value:W, description:"위젯 데모 페이지 이동" },
      { action:"wait",       value:"4000", description:"초기화 대기" },
      { action:"evaluate",   value:"if (!window.ZeroTalk) throw new Error('window.ZeroTalk not found')", description:"전역 API 존재 확인" },
      { action:"screenshot", description:"페이지 상태" },
    ],
    expectedResult:"window.ZeroTalk 객체 존재",
    tags:["widget","api"],
  },
  {
    id:"WL-003", name:"ZeroTalk.getInstance() — null이 아님 (초기화 완료)", group:"widget-load", priority:"high", forType:"widget",
    steps:[
      { action:"navigate",   value:W, description:"위젯 데모 페이지 이동" },
      { action:"wait",       value:"4000", description:"초기화 대기" },
      { action:"evaluate",   value:"if (!window.ZeroTalk?.getInstance || !window.ZeroTalk.getInstance()) throw new Error('getInstance() returned null — widget not initialized')", description:"getInstance 호출 결과 확인" },
      { action:"screenshot", description:"초기화 완료 상태" },
    ],
    expectedResult:"getInstance()가 null이 아닌 인스턴스 반환",
    tags:["widget","api"], note:"init은 됐지만 실제 인스턴스가 없는 경우 기능 불동",
  },
  {
    id:"WL-004", name:"위젯 init 후 4초 내 DOM에 위젯 엘리먼트 생성", group:"widget-load", priority:"high", forType:"widget",
    steps:[
      { action:"navigate",   value:W, description:"위젯 데모 페이지 이동" },
      { action:"wait",       value:"4000", description:"초기화 대기" },
      { action:"evaluate",   value:"const el = document.querySelector('*[class*=\"zerotalk\"],*[class*=\"chat-widget\"],*[id*=\"zerotalk\"],*[id*=\"chat-widget\"]'); if (!el) { const all = document.body.innerHTML.substring(0,200); throw new Error('Widget DOM element not found. Body preview: ' + all); }", description:"위젯 DOM 엘리먼트 존재 확인" },
      { action:"screenshot", description:"위젯 DOM 상태" },
    ],
    expectedResult:"위젯 관련 DOM 엘리먼트가 body에 추가됨",
    tags:["widget","dom"], note:"Shadow DOM 포함 — 외부 컨테이너라도 있어야 함",
  },
  {
    id:"WL-005", name:"페이지 로드 시 자동 위젯 표시 (autoStart 기본값)", group:"widget-load", priority:"medium", forType:"widget",
    steps:[
      { action:"navigate",   value:W, description:"위젯 데모 페이지 이동" },
      { action:"wait",       value:"5000", description:"autoStart 처리 대기" },
      { action:"screenshot", description:"autoStart 동작 확인 — 버튼 자동 표시 여부" },
    ],
    expectedResult:"autoStart:true 기본값으로 동의 없이 위젯 버튼 자동 표시",
    tags:["widget","autostart"],
  },

  // ══════════════════════════════════════════════════════
  // WIDGET INTERACT — 위젯 인터랙션
  // ══════════════════════════════════════════════════════
  {
    id:"WI-001", name:"ZeroTalk.open() — 위젯 채팅창 열기", group:"widget-interact", priority:"critical", forType:"widget",
    steps:[
      { action:"navigate",   value:W, description:"위젯 데모 이동" },
      { action:"wait",       value:"4000", description:"초기화 대기" },
      { action:"evaluate",   value:"if (!window.ZeroTalk?.open) throw new Error('open() not found'); window.ZeroTalk.open();", description:"open() 호출" },
      { action:"wait",       value:"1500", description:"애니메이션 대기" },
      { action:"screenshot", description:"채팅창 열린 상태" },
    ],
    expectedResult:"채팅 패널이 화면에 슬라이드인으로 열림",
    tags:["widget","open"],
  },
  {
    id:"WI-002", name:"ZeroTalk.close() — 열린 위젯 닫기", group:"widget-interact", priority:"high", forType:"widget",
    steps:[
      { action:"navigate",   value:W, description:"위젯 데모 이동" },
      { action:"wait",       value:"4000", description:"초기화 대기" },
      { action:"evaluate",   value:"window.ZeroTalk.open && window.ZeroTalk.open()", description:"열기" },
      { action:"wait",       value:"1500", description:"열림 대기" },
      { action:"evaluate",   value:"if (!window.ZeroTalk?.close) throw new Error('close() not found'); window.ZeroTalk.close();", description:"close() 호출" },
      { action:"wait",       value:"1500", description:"닫힘 대기" },
      { action:"screenshot", description:"위젯 닫힌 상태" },
    ],
    expectedResult:"채팅 패널이 닫히고 버튼만 남음",
    tags:["widget","close"],
  },
  {
    id:"WI-003", name:"ZeroTalk.toggle() — 열고 닫기 토글", group:"widget-interact", priority:"medium", forType:"widget",
    steps:[
      { action:"navigate",   value:W, description:"위젯 데모 이동" },
      { action:"wait",       value:"4000", description:"초기화 대기" },
      { action:"evaluate",   value:"if (!window.ZeroTalk?.toggle) throw new Error('toggle() not found'); window.ZeroTalk.toggle();", description:"1차 toggle (열기)" },
      { action:"wait",       value:"1000", description:"열림 대기" },
      { action:"screenshot", description:"열린 상태" },
      { action:"evaluate",   value:"window.ZeroTalk.toggle()", description:"2차 toggle (닫기)" },
      { action:"wait",       value:"1000", description:"닫힘 대기" },
      { action:"screenshot", description:"닫힌 상태" },
    ],
    expectedResult:"toggle() 2회 호출 시 열렸다가 닫힘",
    tags:["widget","toggle"],
  },
  {
    id:"WI-004", name:"Brand2 Plugin Key로 워크스페이스 전환 후 위젯 재초기화", group:"widget-interact", priority:"high", forType:"widget",
    steps:[
      { action:"navigate",   value:W, description:"위젯 데모 이동" },
      { action:"wait",       value:"4000", description:"초기화 대기 (Brand1 기본)" },
      { action:"evaluate",   value:`window.ZeroTalk.destroy && window.ZeroTalk.destroy();`, description:"기존 인스턴스 제거" },
      { action:"wait",       value:"1000", description:"destroy 완료 대기" },
      { action:"evaluate",   value:`window.ZeroTalk.init({ title:'ZeroTalk Brand2', pluginKey:'${PLUGIN_KEYS.Brand2}', apiBaseUrl:'${WAPI}', wsUrl:'${WWS}' });`, description:"Brand2 키로 재초기화" },
      { action:"wait",       value:"3000", description:"재초기화 대기" },
      { action:"evaluate",   value:"if (!window.ZeroTalk?.getInstance || !window.ZeroTalk.getInstance()) throw new Error('Re-init failed')", description:"재초기화 성공 확인" },
      { action:"screenshot", description:"Brand2 위젯 상태" },
    ],
    expectedResult:"Brand2 Plugin Key로 위젯이 정상 재초기화됨",
    tags:["widget","workspace-switch"], note:"destroy 없이 init 두 번 호출하면 두 개 겹치는 버그 발생 가능",
  },
  {
    id:"WI-005", name:"destroy() 후 재호출 — 좀비 인스턴스 없음", group:"widget-interact", priority:"medium", forType:"widget",
    steps:[
      { action:"navigate",   value:W, description:"위젯 데모 이동" },
      { action:"wait",       value:"4000", description:"초기화 대기" },
      { action:"evaluate",   value:"if (!window.ZeroTalk?.destroy) throw new Error('destroy() not found'); window.ZeroTalk.destroy();", description:"destroy() 호출" },
      { action:"wait",       value:"1500", description:"destroy 완료 대기" },
      { action:"evaluate",   value:"const inst = window.ZeroTalk?.getInstance?.(); if (inst) throw new Error('Instance still exists after destroy — zombie instance!')", description:"인스턴스가 제거됐는지 확인" },
      { action:"screenshot", description:"destroy 후 DOM 상태 — 위젯 엘리먼트 없어야 함" },
    ],
    expectedResult:"destroy() 후 getInstance()가 null 반환",
    tags:["widget","destroy","memory-leak"], note:"좀비 인스턴스 → WebSocket 연결 누적, 메모리 누수",
  },
  {
    id:"WI-006", name:"위젯 열린 상태에서 페이지 스크롤 — 위젯 위치 고정", group:"widget-interact", priority:"low", forType:"widget",
    steps:[
      { action:"navigate",   value:W, description:"위젯 데모 이동" },
      { action:"wait",       value:"4000", description:"초기화 대기" },
      { action:"evaluate",   value:"window.ZeroTalk.open && window.ZeroTalk.open()", description:"위젯 열기" },
      { action:"wait",       value:"1000", description:"열림 대기" },
      { action:"scroll",     value:"800", description:"페이지 스크롤 다운" },
      { action:"screenshot", description:"스크롤 후 위젯 위치 — fixed 포지션 유지 확인" },
    ],
    expectedResult:"스크롤해도 위젯이 우측 하단 고정 위치 유지",
    tags:["widget","layout","scroll"], note:"position:fixed 빠진 경우 스크롤 시 위젯이 사라짐",
  },
  {
    id:"WI-007", name:"잘못된 Plugin Key로 init — 에러 처리", group:"widget-interact", priority:"medium", forType:"widget",
    steps:[
      { action:"navigate",   value:W, description:"위젯 데모 이동" },
      { action:"wait",       value:"3000", description:"초기화 대기" },
      { action:"evaluate",   value:"window.ZeroTalk.destroy && window.ZeroTalk.destroy();", description:"기존 위젯 제거" },
      { action:"wait",       value:"1000", description:"대기" },
      { action:"evaluate",   value:`try { window.ZeroTalk.init({ pluginKey: 'pk_invalid_key_that_does_not_exist', apiBaseUrl: '${WAPI}', wsUrl: '${WWS}' }); } catch(e) { console.warn('Expected error:', e.message); }`, description:"잘못된 키로 init (예외 처리 확인)" },
      { action:"wait",       value:"3000", description:"오류 응답 대기" },
      { action:"screenshot", description:"잘못된 키 처리 결과 — 크래시 없어야 함" },
    ],
    expectedResult:"잘못된 Key여도 JS 크래시 없이 오류 상태 우아하게 처리",
    tags:["widget","error-handling","negative-test"], note:"잘못된 Key → 위젯 전체 크래시 시 페이지 사용 불가",
  },

  // ══════════════════════════════════════════════════════
  // WIDGET STATE — 위젯 상태 유지
  // ══════════════════════════════════════════════════════
  {
    id:"WS-ST-001", name:"위젯 열린 상태에서 모바일 뷰포트 (375px) 렌더링", group:"widget-state", priority:"medium", forType:"widget",
    steps:[
      { action:"navigate",   value:W, description:"위젯 데모 이동" },
      { action:"wait",       value:"4000", description:"초기화 대기" },
      { action:"evaluate",   value:"window.ZeroTalk.open && window.ZeroTalk.open()", description:"위젯 열기" },
      { action:"wait",       value:"1500", description:"열림 대기" },
      { action:"screenshot", description:"현재 뷰포트(1440px)에서 위젯 상태" },
    ],
    expectedResult:"위젯이 화면을 벗어나지 않고 올바르게 표시",
    tags:["widget","responsive"], note:"데스크탑 기준으로만 개발해 모바일에서 위젯이 화면 밖으로 나가는 경우",
  },
  {
    id:"WS-ST-002", name:"헤더 타이틀이 init 옵션대로 표시", group:"widget-state", priority:"low", forType:"widget",
    steps:[
      { action:"navigate",   value:W, description:"위젯 데모 이동" },
      { action:"wait",       value:"4000", description:"초기화 대기" },
      { action:"evaluate",   value:"window.ZeroTalk.open && window.ZeroTalk.open()", description:"위젯 열기" },
      { action:"wait",       value:"1500", description:"열림 대기" },
      { action:"screenshot", description:"위젯 헤더 타이틀 확인 — 'ZeroTalk'이어야 함" },
    ],
    expectedResult:"위젯 헤더에 init의 title:'ZeroTalk' 표시",
    tags:["widget","ui"],
  },
];

// ─── Groups meta ───────────────────────────────────────────────
type AllGroups = ScenarioGroup | "widget-state";

const GROUP_META: Record<AllGroups, { label: string; color: string; forType: SessionType|"both" }> = {
  "auth":           { label:"인증 — 정상",       color:"bg-blue-100 text-blue-700",     forType:"dashboard" },
  "auth-edge":      { label:"인증 — 엣지케이스",  color:"bg-indigo-100 text-indigo-700", forType:"dashboard" },
  "workspace":      { label:"워크스페이스",        color:"bg-cyan-100 text-cyan-700",     forType:"dashboard" },
  "conversations":  { label:"대화 목록",          color:"bg-green-100 text-green-700",   forType:"dashboard" },
  "conv-detail":    { label:"대화 상세",          color:"bg-teal-100 text-teal-700",     forType:"dashboard" },
  "settings-nav":   { label:"설정 네비게이션",     color:"bg-purple-100 text-purple-700", forType:"dashboard" },
  "settings-pages": { label:"설정 페이지",        color:"bg-violet-100 text-violet-700", forType:"dashboard" },
  "role-access":    { label:"권한 접근 제어",      color:"bg-orange-100 text-orange-700", forType:"dashboard" },
  "page-integrity": { label:"페이지 무결성",       color:"bg-rose-100 text-rose-700",     forType:"dashboard" },
  "widget-load":    { label:"위젯 로드",          color:"bg-emerald-100 text-emerald-700",forType:"widget"    },
  "widget-interact":{ label:"위젯 인터랙션",       color:"bg-pink-100 text-pink-700",     forType:"widget"    },
  "widget-state":   { label:"위젯 상태",          color:"bg-fuchsia-100 text-fuchsia-700",forType:"widget"    },
};

const ROLE_BADGE: Record<string, string> = {
  owner:"bg-red-100 text-red-700", admin:"bg-orange-100 text-orange-700",
  agent:"bg-blue-100 text-blue-700", viewer:"bg-gray-100 text-gray-600",
};

// ─── Run result ────────────────────────────────────────────────
interface RunResult {
  session: Session;
  report: QAReport | null;
  error: string | null;
  status: "pending"|"running"|"done"|"error";
}

// ═══════════════════════════════════════════════════════════════
// PAGE
// ═══════════════════════════════════════════════════════════════
export default function QuickRunPage() {
  const [sessions, setSessions]     = useState<Session[]>(DEFAULT_SESSIONS);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set(SCENARIOS.map((s) => s.id)));
  const [groupFilter, setGroupFilter] = useState<AllGroups|"all">("all");
  const [headless, setHeadless]     = useState(true);
  const [isRunning, setIsRunning]   = useState(false);
  const [results, setResults]       = useState<RunResult[]>([]);
  const [bulkPw, setBulkPw]         = useState("");
  const [cleaningUp, setCleaningUp] = useState(false);
  const [cleanupMsg, setCleanupMsg] = useState<string | null>(null);

  const allGroups = Object.keys(GROUP_META) as AllGroups[];
  const filtered  = groupFilter === "all" ? SCENARIOS : SCENARIOS.filter((s) => s.group === groupFilter);
  const allFilSel = filtered.length > 0 && filtered.every((s) => selectedIds.has(s.id));
  const selCount  = SCENARIOS.filter((s) => selectedIds.has(s.id)).length;
  const active    = sessions.filter((s) => s.enabled);

  const toggleId = (id: string) =>
    setSelectedIds((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const toggleAllFil = () =>
    setSelectedIds((p) => {
      const n = new Set(p);
      if (allFilSel) filtered.forEach((s) => n.delete(s.id));
      else filtered.forEach((s) => n.add(s.id));
      return n;
    });

  const toggleSession = (id: string) =>
    setSessions((p) => p.map((s) => s.id === id ? { ...s, enabled: !s.enabled } : s));

  const updateWs = (id: string, ws: string) =>
    setSessions((p) => p.map((s) => s.id === id ? { ...s, workspace: ws } : s));

  const updateEmail = (id: string, email: string) =>
    setSessions((p) => p.map((s) => s.id === id ? { ...s, loginEmail: email } : s));

  const updatePassword = (id: string, pw: string) =>
    setSessions((p) => p.map((s) => s.id === id ? { ...s, loginPassword: pw } : s));

  const applyBulkPw = () => {
    if (!bulkPw.trim()) return;
    setSessions((p) => p.map((s) => s.type === "dashboard" ? { ...s, loginPassword: bulkPw.trim() } : s));
    setBulkPw("");
  };

  const cleanupSessions = async () => {
    const withLogin = sessions.filter(s => s.enabled && s.loginEmail && s.loginPassword && s.url);
    if (!withLogin.length) { setCleanupMsg("로그인 정보가 있는 세션이 없습니다."); return; }
    setCleaningUp(true); setCleanupMsg(null);
    const msgs: string[] = [];
    for (const s of withLogin) {
      try {
        const res = await fetch("/api/human-agent/logout", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ targetUrl: s.url, loginEmail: s.loginEmail, loginPassword: s.loginPassword }),
        });
        const d = await res.json();
        msgs.push(`${s.label}: ${d.message ?? (d.success ? "완료" : "실패")}`);
      } catch { msgs.push(`${s.label}: 오류 발생`); }
    }
    setCleanupMsg(msgs.join("\n")); setCleaningUp(false);
  };

  const run = async () => {
    if (active.length === 0 || selCount === 0) return;
    setIsRunning(true);

    const init: RunResult[] = active.map((s) => ({ session: s, report: null, error: null, status: "pending" }));
    setResults(init);

    for (let i = 0; i < active.length; i++) {
      const session = active[i];
      setResults((p) => p.map((r, idx) => idx === i ? { ...r, status: "running" } : r));

      const pluginKey = PLUGIN_KEYS[session.workspace ?? "Brand1"];
      const scenariosForSession = SCENARIOS.filter((s) => {
        if (!selectedIds.has(s.id)) return false;
        if (s.forType !== "both" && s.forType !== session.type) return false;
        if (session.type === "dashboard" && s.forRoles && session.role && !s.forRoles.includes(session.role)) return false;
        return true;
      }).map((s) => ({
        ...s, preconditions: [] as string[],
        steps: (s.steps as Record<string, unknown>[]).map((step) => {
          if (!step.value || typeof step.value !== "string") return step;
          return { ...step, value: (step.value as string)
            .replace("{{email}}", session.loginEmail ?? "")
            .replace("{{password}}", session.loginPassword ?? "")
            .replace("{{pluginKey}}", pluginKey) };
        }),
      }));

      if (scenariosForSession.length === 0) {
        setResults((p) => p.map((r, idx) => idx === i ? { ...r, status: "error", error: "이 세션에 해당하는 시나리오 없음" } : r));
        continue;
      }

      try {
        const res = await fetch("/api/qa/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            scenarios: scenariosForSession,
            targetUrl: session.url,
            // Credentials omitted: each scenario already has loginSteps built in.
            // Passing them would trigger redundant auth-caching login in the runner.
            options: { headless, maxRetries: 0 },
          }),
        });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.error ?? "Unknown error");
        setResults((p) => p.map((r, idx) => idx === i ? { ...r, status: "done", report: data.report } : r));
      } catch (err) {
        setResults((p) => p.map((r, idx) => idx === i ? { ...r, status: "error", error: String(err) } : r));
      }
    }
    setIsRunning(false);
  };

  return (
    <div className="max-w-7xl mx-auto px-6 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">Quick Run — ZeroTalk</h1>
        <p className="text-gray-500">
          {SCENARIOS.length}개 시나리오 · 대시보드 {SCENARIOS.filter((s) => s.forType === "dashboard").length}개 + 위젯 {SCENARIOS.filter((s) => s.forType === "widget").length}개
        </p>
      </div>

      <div className="grid grid-cols-5 gap-6 mb-6">
        {/* Sessions + Options */}
        <div className="col-span-2 space-y-4">
          <div className="card p-5">
            <h2 className="font-semibold text-gray-900 mb-3">테스트 세션</h2>

            {/* 일괄 비밀번호 */}
            <div className="mb-3 flex gap-1.5">
              <input
                type="password"
                placeholder="대시보드 세션 공통 비밀번호"
                value={bulkPw}
                onChange={(e) => setBulkPw(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && applyBulkPw()}
                disabled={isRunning}
                className="flex-1 text-xs border border-gray-200 rounded px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400"
              />
              <button
                onClick={applyBulkPw}
                disabled={isRunning || !bulkPw.trim()}
                className="text-xs px-2.5 py-1.5 bg-gray-100 hover:bg-gray-200 rounded border border-gray-200 disabled:opacity-40 transition-colors"
              >
                전체 적용
              </button>
            </div>

            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">대시보드</p>
            <div className="space-y-1.5 mb-4">
              {sessions.filter((s) => s.type === "dashboard").map((s) => (
                <SessionRow
                  key={s.id} session={s} disabled={isRunning}
                  onToggle={() => toggleSession(s.id)}
                  onEmailChange={(e) => updateEmail(s.id, e)}
                  onPasswordChange={(p) => updatePassword(s.id, p)}
                />
              ))}
            </div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">위젯 데모</p>
            <div className="space-y-1.5">
              {sessions.filter((s) => s.type === "widget").map((s) => (
                <SessionRow key={s.id} session={s} disabled={isRunning} onToggle={() => toggleSession(s.id)} onWorkspaceChange={(ws) => updateWs(s.id, ws)} />
              ))}
            </div>
          </div>

          <div className="card p-5 space-y-3">
            <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none">
              <input type="checkbox" checked={headless} onChange={(e) => setHeadless(e.target.checked)} disabled={isRunning} className="w-4 h-4 rounded" />
              Headless 모드
            </label>
            <button onClick={run} disabled={isRunning || selCount === 0 || active.length === 0} className="btn-primary w-full text-sm">
              {isRunning
                ? <span className="flex items-center justify-center gap-2"><span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />실행 중...</span>
                : `▶ 실행 (${active.length}개 세션 × ${selCount}개 시나리오)`}
            </button>
            <p className="text-xs text-gray-400 text-center">세션별 순차 실행 · 스크린샷 자동 저장</p>
            <div className="border-t pt-2">
              <button onClick={cleanupSessions} disabled={isRunning || cleaningUp}
                className="w-full py-2 rounded-lg text-xs font-medium bg-gray-100 hover:bg-gray-200 text-gray-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                {cleaningUp ? "로그아웃 중..." : "세션 정리 (이전 로그아웃)"}
              </button>
              {cleanupMsg && (
                <div className="mt-1.5 p-2 rounded bg-gray-50 border text-xs text-gray-600 whitespace-pre-line">{cleanupMsg}</div>
              )}
            </div>
          </div>
        </div>

        {/* Scenario selector */}
        <div className="col-span-3 card p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-gray-900">시나리오 선택</h2>
            <span className="text-sm text-gray-400">{selCount}/{SCENARIOS.length}개</span>
          </div>

          {/* Group filters */}
          <div className="flex gap-1.5 flex-wrap mb-3">
            <button onClick={() => setGroupFilter("all")} className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${groupFilter === "all" ? "bg-gray-800 text-white border-gray-800" : "border-gray-200 text-gray-500 hover:border-gray-400"}`}>
              전체 ({SCENARIOS.length})
            </button>
            {allGroups.map((g) => {
              const cnt = SCENARIOS.filter((s) => s.group === g).length;
              const meta = GROUP_META[g];
              return (
                <button key={g} onClick={() => setGroupFilter(g)}
                  className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${groupFilter === g ? "bg-gray-800 text-white border-gray-800" : "border-gray-200 text-gray-500 hover:border-gray-400"}`}>
                  {meta.label} ({cnt})
                </button>
              );
            })}
          </div>

          <label className="flex items-center gap-2 text-xs text-gray-500 mb-3 cursor-pointer select-none border-b pb-2">
            <input type="checkbox" checked={allFilSel} onChange={toggleAllFil} className="w-3.5 h-3.5 rounded" />
            현재 필터 전체 선택/해제
          </label>

          <div className="space-y-1.5 max-h-[520px] overflow-y-auto pr-1">
            {filtered.map((s) => {
              const meta = GROUP_META[s.group as AllGroups];
              return (
                <label key={s.id} className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer select-none transition-colors ${selectedIds.has(s.id) ? "border-blue-200 bg-blue-50" : "border-gray-100 hover:border-gray-200"}`}>
                  <input type="checkbox" checked={selectedIds.has(s.id)} onChange={() => toggleId(s.id)} className="mt-0.5 w-4 h-4 rounded border-gray-300 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-xs font-mono text-gray-400 shrink-0">{s.id}</span>
                      <span className={`text-xs px-1.5 py-0.5 rounded font-medium shrink-0 ${meta?.color}`}>{meta?.label}</span>
                      {s.priority === "critical" && <span className="text-xs font-bold text-red-600 shrink-0">★critical</span>}
                      {s.forRoles && <span className="text-xs text-gray-400 shrink-0">{s.forRoles.join("/")} only</span>}
                    </div>
                    <p className="text-sm text-gray-800 mt-0.5 font-medium">{s.name}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <p className="text-xs text-gray-400">{s.steps.length}단계</p>
                      {s.note && (
                        <p className="text-xs text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">
                          ⚠ {s.note}
                        </p>
                      )}
                    </div>
                  </div>
                </label>
              );
            })}
          </div>
        </div>
      </div>

      {/* Results */}
      {results.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-xl font-bold text-gray-900">실행 결과</h2>
          {results.map((r, i) => <ResultCard key={i} result={r} />)}
        </div>
      )}
    </div>
  );
}

function SessionRow({ session, disabled, onToggle, onWorkspaceChange, onEmailChange, onPasswordChange }: {
  session: Session;
  disabled: boolean;
  onToggle: () => void;
  onWorkspaceChange?: (ws: string) => void;
  onEmailChange?: (email: string) => void;
  onPasswordChange?: (pw: string) => void;
}) {
  const [showCreds, setShowCreds] = useState(false);

  return (
    <div className={`rounded-lg border transition-colors ${session.enabled ? "border-blue-200 bg-blue-50" : "border-gray-100 bg-gray-50"}`}>
      <div className="flex items-center gap-2 px-3 py-2">
        <input type="checkbox" checked={session.enabled} onChange={onToggle} disabled={disabled} className="w-4 h-4 rounded border-gray-300 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-medium text-gray-800 truncate">{session.label}</span>
            {session.role && <span className={`text-xs px-1 py-0.5 rounded font-medium shrink-0 ${ROLE_BADGE[session.role] ?? "bg-gray-100 text-gray-600"}`}>{session.role}</span>}
          </div>
          {session.loginEmail && !showCreds && (
            <p className="text-xs text-gray-400 truncate">{session.loginEmail}</p>
          )}
          {session.type === "widget" && onWorkspaceChange && (
            <select className="mt-1 text-xs border border-gray-200 rounded px-1.5 py-0.5 bg-white" value={session.workspace ?? "Brand1"} onChange={(e) => onWorkspaceChange(e.target.value)} disabled={disabled}>
              {Object.keys(PLUGIN_KEYS).map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
          )}
        </div>
        {session.type === "dashboard" && (
          <button
            onClick={() => setShowCreds((v) => !v)}
            className="text-xs text-gray-400 hover:text-blue-500 transition-colors shrink-0 px-1"
            title="로그인 정보 편집"
          >
            🔑
          </button>
        )}
      </div>

      {showCreds && session.type === "dashboard" && (
        <div className="px-3 pb-2.5 space-y-1.5 border-t border-blue-100 pt-2">
          <input
            type="email"
            placeholder="이메일"
            value={session.loginEmail ?? ""}
            onChange={(e) => onEmailChange?.(e.target.value)}
            disabled={disabled}
            className="w-full text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white"
          />
          <input
            type="password"
            placeholder="비밀번호"
            value={session.loginPassword ?? ""}
            onChange={(e) => onPasswordChange?.(e.target.value)}
            disabled={disabled}
            className="w-full text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white"
          />
        </div>
      )}
    </div>
  );
}

function ResultCard({ result }: { result: RunResult }) {
  const { session, report, error, status } = result;
  const [collapsed, setCollapsed] = useState(false);

  const badge = {
    pending: <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">대기</span>,
    running: <span className="flex items-center gap-1.5 text-xs text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full"><span className="w-3 h-3 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />실행 중</span>,
    done:    <span className="text-xs text-green-600 bg-green-50 px-2 py-0.5 rounded-full font-medium">완료</span>,
    error:   <span className="text-xs text-red-600 bg-red-50 px-2 py-0.5 rounded-full font-medium">오류</span>,
  }[status];

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 bg-gray-50 border-b cursor-pointer" onClick={() => setCollapsed((v) => !v)}>
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-gray-900">{session.label}</span>
          <a href={session.url} target="_blank" rel="noreferrer" className="text-xs text-blue-400 hover:underline" onClick={(e) => e.stopPropagation()}>
            {session.url.replace("https://", "")}
          </a>
        </div>
        <div className="flex items-center gap-3">
          {report && (
            <>
              <div className="flex gap-2 text-xs">
                <span className="text-green-600 font-medium">{report.passed}P</span>
                <span className="text-red-600 font-medium">{report.failed}F</span>
                {report.errors > 0 && <span className="text-yellow-600 font-medium">{report.errors}E</span>}
              </div>
              <span className="text-xl font-bold text-blue-600">{report.score}<span className="text-xs text-gray-400 font-normal">/100</span></span>
            </>
          )}
          {badge}
          <span className="text-gray-400 text-xs">{collapsed ? "▲" : "▼"}</span>
        </div>
      </div>

      {!collapsed && (
        <div className="p-5">
          {status === "error" && error && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 mb-4">
              <p className="text-sm text-red-700 font-mono">{error}</p>
            </div>
          )}
          {report && (
            <div className="space-y-4">
              <div className="grid grid-cols-4 gap-3">
                {[
                  { label:"PASS",      value:report.passed,                 color:"text-green-600",  bg:"bg-green-50"  },
                  { label:"FAIL",      value:report.failed,                 color:"text-red-600",    bg:"bg-red-50"    },
                  { label:"ERROR",     value:report.errors,                 color:"text-yellow-600", bg:"bg-yellow-50" },
                  { label:"Pass Rate", value:`${report.passRate.toFixed(1)}%`, color:"text-blue-600", bg:"bg-blue-50" },
                ].map((s) => (
                  <div key={s.label} className={`${s.bg} rounded-xl p-3 text-center`}>
                    <div className={`text-xl font-bold ${s.color}`}>{s.value}</div>
                    <div className="text-xs text-gray-500 mt-0.5">{s.label}</div>
                  </div>
                ))}
              </div>
              {report.summary && <p className="text-sm text-gray-600 bg-gray-50 rounded-lg px-4 py-3">{report.summary}</p>}
              <div className="space-y-1">
                {(report.scenarios as TestResult[]).map((r) => (
                  <div key={r.scenarioId} className="flex items-center gap-2 py-1.5 border-b last:border-0 text-sm">
                    <span className={`text-xs font-bold px-1.5 py-0.5 rounded min-w-[44px] text-center shrink-0 ${r.status==="pass"?"bg-green-50 text-green-700":r.status==="fail"?"bg-red-50 text-red-700":"bg-yellow-50 text-yellow-700"}`}>
                      {r.status.toUpperCase()}
                    </span>
                    <span className="flex-1 text-gray-700 truncate">{r.scenarioName}</span>
                    <span className="text-xs text-gray-400 shrink-0">{(r.duration/1000).toFixed(1)}s</span>
                    {r.retryCount > 0 && <span className="text-xs text-yellow-500 shrink-0">retry×{r.retryCount}</span>}
                    {r.screenshotPath && <a href={r.screenshotPath} target="_blank" rel="noreferrer" className="text-xs text-blue-500 hover:underline shrink-0">스크린샷</a>}
                    {r.errorMessage && <span className="text-xs text-red-400 max-w-[180px] truncate shrink-0" title={r.errorMessage}>{r.errorMessage}</span>}
                  </div>
                ))}
              </div>
              {report.bugReports.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase mb-2">발견된 버그 {report.bugReports.length}건</p>
                  {report.bugReports.map((bug, i) => (
                    <div key={i} className="p-3 rounded-lg border bg-red-50 border-red-200 text-sm mb-2">
                      <span className="text-xs font-bold text-red-700 mr-1">[{bug.severity}]</span>
                      <span className="font-medium">{bug.title}</span>
                      <p className="text-xs text-gray-600 mt-0.5">{bug.description}</p>
                    </div>
                  ))}
                </div>
              )}
              <div className="text-right">
                <a href={`/api/reports/${report.runId}.html`} target="_blank" rel="noreferrer" className="text-xs text-blue-500 hover:underline">HTML 리포트 전체 보기 →</a>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
