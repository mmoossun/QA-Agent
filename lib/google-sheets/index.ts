/**
 * Google Sheets API client — OAuth2 Refresh Token authentication
 *
 * Dynamic sheet support:
 *  - Auto-detects tabs (no hardcoded "TestCases" assumption)
 *  - Reads header row and maps columns by name (Korean + English synonyms)
 *  - Writes back preserving the original column order of the sheet
 *
 * Required env vars:
 *   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN
 */

import { google, sheets_v4 } from "googleapis";

export interface TestCase {
  id: string;
  category: string;
  title: string;
  steps: string;
  expectedResult: string;
  priority: "High" | "Medium" | "Low";
  status: "Not Run" | "Pass" | "Fail" | "Skip";
  notes: string;
}

export interface SheetTab {
  title: string;
  index: number;
}

// ── Auth ──────────────────────────────────────────────────────
function getAuth() {
  const clientId     = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      "Google Sheets 환경변수 미설정: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN"
    );
  }

  const oauth2 = new google.auth.OAuth2(clientId, clientSecret);
  oauth2.setCredentials({ refresh_token: refreshToken });
  return oauth2;
}

function getSheetsClient(): sheets_v4.Sheets {
  return google.sheets({ version: "v4", auth: getAuth() });
}

// ── Get all tab names from a spreadsheet ──────────────────────
export async function getSheetTabs(sheetId: string): Promise<SheetTab[]> {
  const sheets = getSheetsClient();
  const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
  return (meta.data.sheets ?? []).map(s => ({
    title: s.properties?.title ?? "",
    index: s.properties?.index ?? 0,
  }));
}

// ── Column synonym map → TestCase field ───────────────────────
const COL_SYNONYMS: Record<keyof TestCase, string[]> = {
  id:             ["id", "#", "no", "번호", "케이스id", "케이스번호", "test id", "testid"],
  category:       ["category", "카테고리", "분류", "유형", "type", "도메인", "domain"],
  title:          ["title", "제목", "테스트명", "케이스명", "name", "테스트케이스", "test case", "항목", "시나리오명", "시나리오", "scenario"],
  steps:          ["steps", "스텝", "단계", "실행단계", "실행방법", "테스트단계", "test steps", "절차", "테스트단계", "테스트방법"],
  expectedResult: ["expectedresult", "expected result", "기대결과", "예상결과", "기대값", "기대동작", "expected", "예상결과"],
  priority:       ["priority", "우선순위", "중요도"],
  status:         ["status", "상태", "결과", "테스트결과", "판정", "pass/fail", "passfail"],
  notes:          ["notes", "노트", "비고", "메모", "note", "remarks", "설명"],
};

function matchColumn(header: string): keyof TestCase | null {
  const normalized = header.toLowerCase().replace(/[\s_\-]/g, "");
  if (!normalized) return null;
  for (const [field, synonyms] of Object.entries(COL_SYNONYMS)) {
    if (synonyms.some(s => normalized === s.replace(/[\s_\-]/g, ""))) {
      return field as keyof TestCase;
    }
  }
  // Partial match fallback — require both sides to be at least 2 chars
  if (normalized.length < 2) return null;
  for (const [field, synonyms] of Object.entries(COL_SYNONYMS)) {
    if (synonyms.some(s => {
      const sn = s.replace(/[\s_\-]/g, "");
      if (sn.length < 2) return false;
      return normalized.includes(sn) || sn.includes(normalized);
    })) {
      return field as keyof TestCase;
    }
  }
  return null;
}

// Detect column mapping from header row
// Returns: array of TestCase field names aligned to column index (null = unmapped)
function buildColumnMap(headers: string[]): Array<keyof TestCase | null> {
  return headers.map(h => matchColumn(h));
}

function normalizeStatus(val: string): TestCase["status"] {
  const v = val.toLowerCase().trim();
  if (v === "true" || v.includes("pass") || v === "통과" || v === "성공" || v === "합격") return "Pass";
  if (v === "false" || v.includes("fail") || v === "실패" || v === "불합격") return "Fail";
  if (v.includes("skip") || v === "스킵" || v === "제외") return "Skip";
  return "Not Run";
}

function normalizePriority(val: string): TestCase["priority"] {
  const v = val.toLowerCase();
  if (v.includes("high") || v === "높음" || v === "상") return "High";
  if (v.includes("low") || v === "낮음" || v === "하") return "Low";
  return "Medium";
}

// ── Sheet analysis ────────────────────────────────────────────
export interface SheetAnalysis {
  tabName: string;
  headers: string[];
  headerRowIndex: number;
  columnMapping: Array<{
    header: string;
    field: keyof TestCase | null;
    sampleValues: string[];
  }>;
  totalDataRows: number;
  formatDescription: string;
}

export async function analyzeSheet(sheetId: string, tabName?: string): Promise<SheetAnalysis> {
  const sheets = getSheetsClient();

  let resolvedTab = tabName;
  if (!resolvedTab) {
    const tabs = await getSheetTabs(sheetId);
    if (!tabs.length) throw new Error("스프레드시트에 탭이 없습니다");
    resolvedTab = tabs[0].title;
  }

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `${resolvedTab}!A1:Z`,
  });

  const allRows = res.data.values ?? [];
  if (allRows.length === 0) {
    return { tabName: resolvedTab, headers: [], headerRowIndex: 0, columnMapping: [], totalDataRows: 0, formatDescription: "빈 시트입니다." };
  }

  // Auto-detect header row (same as readSheet)
  let headerRowIdx = 0;
  let bestMatchCount = 0;
  for (let i = 0; i < Math.min(10, allRows.length); i++) {
    const matched = buildColumnMap(allRows[i].map(String)).filter(Boolean).length;
    if (matched > bestMatchCount) { bestMatchCount = matched; headerRowIdx = i; }
  }

  const headers = allRows[headerRowIdx].map(String);
  const colMapFields = buildColumnMap(headers);
  const dataRows = allRows.slice(headerRowIdx + 1).filter(r => r.some(c => String(c ?? "").trim()));

  const columnMapping = headers.map((header, colIdx) => ({
    header,
    field: colMapFields[colIdx],
    sampleValues: dataRows.slice(0, 5).map(row => String(row[colIdx] ?? "").trim()).filter(v => v).slice(0, 3),
  }));

  const colLines = columnMapping.map((col, i) => {
    const fieldLabel = col.field ? ` (→ ${col.field})` : "";
    const samples = col.sampleValues.length > 0 ? ` 예시: ${col.sampleValues.map(v => `"${v}"`).join(", ")}` : "";
    return `  ${i + 1}. "${col.header}"${fieldLabel}${samples}`;
  }).join("\n");

  const formatDescription = `탭명: "${resolvedTab}"\n기존 시트 컬럼 (순서대로):\n${colLines}\n총 데이터 행 수: ${dataRows.length}`;

  return { tabName: resolvedTab, headers, headerRowIndex: headerRowIdx, columnMapping, totalDataRows: dataRows.length, formatDescription };
}

// ── Get raw header row for debugging ─────────────────────────
export async function getRawHeaders(sheetId: string, tabName?: string): Promise<string[][]> {
  const sheets = getSheetsClient();
  let resolvedTab = tabName;
  if (!resolvedTab) {
    const tabs = await getSheetTabs(sheetId);
    resolvedTab = tabs[0]?.title;
  }
  if (!resolvedTab) return [];
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `${resolvedTab}!A1:Z10`,
  });
  return (res.data.values ?? []).map(r => r.map(String));
}

// ── Read sheet: auto-detect tab & columns ─────────────────────
export async function readSheet(
  sheetId: string,
  tabName?: string,
): Promise<TestCase[]> {
  const sheets = getSheetsClient();

  // Auto-select first tab if not specified
  let resolvedTab = tabName;
  if (!resolvedTab) {
    const tabs = await getSheetTabs(sheetId);
    if (!tabs.length) throw new Error("스프레드시트에 탭이 없습니다");
    resolvedTab = tabs[0].title;
  }

  // Read header row + data rows
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `${resolvedTab}!A1:Z`,
  });

  const allRows = res.data.values ?? [];
  if (allRows.length === 0) return [];

  // Auto-detect the header row: find the row with the most column matches
  let headerRowIdx = 0;
  let bestMatchCount = 0;
  for (let i = 0; i < Math.min(10, allRows.length); i++) {
    const row = allRows[i].map(String);
    const matched = buildColumnMap(row).filter(Boolean).length;
    if (matched > bestMatchCount) { bestMatchCount = matched; headerRowIdx = i; }
  }

  const headers = allRows[headerRowIdx].map(String);
  const colMap = buildColumnMap(headers);
  const dataRows = allRows.slice(headerRowIdx + 1);

  return dataRows
    .filter(row => row.some(cell => String(cell ?? "").trim() !== ""))
    .map((row, rowIdx) => {
      const tc: Partial<TestCase> = {};
      colMap.forEach((field, colIdx) => {
        if (!field) return;
        const val = String(row[colIdx] ?? "").trim();
        if (field === "status")   tc.status   = normalizeStatus(val);
        else if (field === "priority") tc.priority = normalizePriority(val);
        else (tc as Record<string, string>)[field] = val;
      });
      return {
        id:             tc.id             ?? `TC-${rowIdx + 1}`,
        category:       tc.category       ?? "기능 테스트",
        title:          tc.title          ?? `테스트 케이스 ${rowIdx + 1}`,
        steps:          tc.steps          ?? "",
        expectedResult: tc.expectedResult ?? "",
        priority:       tc.priority       ?? "Medium",
        status:         tc.status         ?? "Not Run",
        notes:          tc.notes          ?? "",
      } as TestCase;
    });
}

// ── Value format mapper: converts internal English values to sheet's actual format ──
function buildValueMapper(field: keyof TestCase, sampleValues: string[]): (v: string) => string {
  if (field !== "priority" && field !== "status") return v => v;
  const hasKorean = sampleValues.some(v => /[가-힣]/.test(v));
  if (!hasKorean) return v => v;

  if (field === "priority") {
    const hi  = sampleValues.find(v => /높|상|high/i.test(v))            ?? "높음";
    const mid = sampleValues.find(v => /중|보통|medium|미디엄/i.test(v)) ?? "중간";
    const lo  = sampleValues.find(v => /낮|하|low/i.test(v))             ?? "낮음";
    return v => v === "High" ? hi : v === "Medium" ? mid : v === "Low" ? lo : v;
  }

  if (field === "status") {
    const notRun = sampleValues.find(v => /미실행|대기|not.?run/i.test(v)) ?? "미실행";
    const pass   = sampleValues.find(v => /통과|합격|pass/i.test(v))        ?? "통과";
    const fail   = sampleValues.find(v => /실패|불합격|fail/i.test(v))      ?? "실패";
    const skip   = sampleValues.find(v => /스킵|제외|skip/i.test(v))        ?? "스킵";
    return v =>
      v === "Not Run" ? notRun :
      v === "Pass"    ? pass   :
      v === "Fail"    ? fail   :
      v === "Skip"    ? skip   : v;
  }

  return v => v;
}

// ── Append test cases (preserves existing data, matches sheet format) ──
export async function appendTestCases(
  sheetId: string,
  testCases: TestCase[],
  tabName?: string,
): Promise<number> {
  const sheets = getSheetsClient();

  let resolvedTab = tabName;
  if (!resolvedTab) {
    const tabs = await getSheetTabs(sheetId);
    resolvedTab = tabs[0]?.title;
  }

  if (!resolvedTab) {
    resolvedTab = "TestCases";
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: { requests: [{ addSheet: { properties: { title: resolvedTab } } }] },
    });
  }

  // Read all rows to detect header + sample data for format matching
  const allDataRes = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `${resolvedTab}!A1:Z`,
  });

  const allRows = allDataRes.data.values ?? [];
  let colMap: Array<keyof TestCase | null>;
  // Per-column value mapper (e.g. "High" → "높음" if sheet uses Korean)
  const valueMappers: Map<number, (v: string) => string> = new Map();

  if (allRows.length === 0) {
    const STANDARD_HEADERS = ["번호", "카테고리", "테스트 제목", "테스트 단계", "기대 결과", "우선순위", "상태", "비고"];
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `${resolvedTab}!A1`,
      valueInputOption: "RAW",
      requestBody: { values: [STANDARD_HEADERS] },
    });
    colMap = ["id", "category", "title", "steps", "expectedResult", "priority", "status", "notes"];
  } else {
    // Auto-detect header row (most column matches in first 10 rows)
    let headerRowIdx = 0;
    let bestMatchCount = 0;
    for (let i = 0; i < Math.min(10, allRows.length); i++) {
      const matched = buildColumnMap(allRows[i].map(String)).filter(Boolean).length;
      if (matched > bestMatchCount) { bestMatchCount = matched; headerRowIdx = i; }
    }

    colMap = bestMatchCount > 0
      ? buildColumnMap(allRows[headerRowIdx].map(String))
      : ["id", "category", "title", "steps", "expectedResult", "priority", "status", "notes"];

    // Collect sample values per column from existing data rows
    const dataRows = allRows.slice(headerRowIdx + 1).filter(r => r.some(c => String(c ?? "").trim()));
    colMap.forEach((field, colIdx) => {
      if (!field) return;
      const samples = dataRows
        .slice(0, 10)
        .map(row => String(row[colIdx] ?? "").trim())
        .filter(v => v);
      const mapper = buildValueMapper(field, samples);
      valueMappers.set(colIdx, mapper);
    });
  }

  // Build rows aligned to detected column order, applying value format mappers
  const numCols = Math.max(colMap.length, 1);
  const rows = testCases.map(tc => {
    const row = new Array(numCols).fill("");
    colMap.forEach((field, i) => {
      if (!field) return;
      const raw = String(tc[field] ?? "");
      const mapper = valueMappers.get(i);
      row[i] = mapper ? mapper(raw) : raw;
    });
    return row;
  });

  // Calculate the actual last row by scanning column A — write directly below it
  const colARes = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `${resolvedTab}!A:A`,
  });
  const lastRow = colARes.data.values?.length ?? 0;

  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: `${resolvedTab}!A${lastRow + 1}`,
    valueInputOption: "RAW",
    requestBody: { values: rows },
  });

  return rows.length;
}

// ── Update a single row status ────────────────────────────────
export async function updateTestCaseStatus(
  sheetId: string,
  testCaseId: string,
  status: TestCase["status"],
  notes: string,
  tabName?: string,
): Promise<boolean> {
  const sheets = getSheetsClient();

  let resolvedTab = tabName;
  if (!resolvedTab) {
    const tabs = await getSheetTabs(sheetId);
    resolvedTab = tabs[0]?.title;
  }
  if (!resolvedTab) return false;

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `${resolvedTab}!A1:Z`,
  });

  const allRows = res.data.values ?? [];
  if (allRows.length < 2) return false;

  const colMap = buildColumnMap(allRows[0].map(String));
  const idColIdx = colMap.indexOf("id");
  const statusColIdx = colMap.indexOf("status");
  const notesColIdx = colMap.indexOf("notes");

  if (idColIdx === -1) return false;

  const dataRows = allRows.slice(1);
  const rowIdx = dataRows.findIndex(r => String(r[idColIdx] ?? "").trim() === testCaseId);
  if (rowIdx === -1) return false;

  const sheetRow = rowIdx + 2;

  const updates: Array<{ range: string; values: string[][] }> = [];
  if (statusColIdx !== -1) {
    const col = String.fromCharCode(65 + statusColIdx);
    updates.push({ range: `${resolvedTab}!${col}${sheetRow}`, values: [[status]] });
  }
  if (notesColIdx !== -1) {
    const col = String.fromCharCode(65 + notesColIdx);
    updates.push({ range: `${resolvedTab}!${col}${sheetRow}`, values: [[notes]] });
  }

  if (updates.length === 0) return false;

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: sheetId,
    requestBody: {
      valueInputOption: "RAW",
      data: updates,
    },
  });

  return true;
}

// ── Overwrite all rows ────────────────────────────────────────
export async function writeAllTestCases(
  sheetId: string,
  testCases: TestCase[],
  tabName?: string,
): Promise<void> {
  const sheets = getSheetsClient();

  let resolvedTab = tabName;
  if (!resolvedTab) {
    const tabs = await getSheetTabs(sheetId);
    resolvedTab = tabs[0]?.title;
  }
  if (!resolvedTab) throw new Error("탭을 찾을 수 없습니다");

  const headerRes = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `${resolvedTab}!A1:Z1`,
  });

  let colMap: Array<keyof TestCase | null>;
  if (headerRes.data.values?.length) {
    colMap = buildColumnMap(headerRes.data.values[0].map(String));
  } else {
    const STANDARD_HEADERS = ["ID", "Category", "Title", "Steps", "Expected Result", "Priority", "Status", "Notes"];
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `${resolvedTab}!A1`,
      valueInputOption: "RAW",
      requestBody: { values: [STANDARD_HEADERS] },
    });
    colMap = ["id", "category", "title", "steps", "expectedResult", "priority", "status", "notes"];
  }

  await sheets.spreadsheets.values.clear({
    spreadsheetId: sheetId,
    range: `${resolvedTab}!A2:Z`,
  });

  if (testCases.length === 0) return;

  const numCols = colMap.length;
  const rows = testCases.map(tc => {
    const row = new Array(numCols).fill("");
    colMap.forEach((field, i) => {
      if (field) row[i] = tc[field] ?? "";
    });
    return row;
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: `${resolvedTab}!A2`,
    valueInputOption: "RAW",
    requestBody: { values: rows },
  });
}
