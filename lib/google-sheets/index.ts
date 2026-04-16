/**
 * Google Sheets API client — OAuth2 Refresh Token authentication
 *
 * Required env vars:
 *   GOOGLE_CLIENT_ID      — OAuth2 client ID (from Google Cloud Console)
 *   GOOGLE_CLIENT_SECRET  — OAuth2 client secret
 *   GOOGLE_REFRESH_TOKEN  — long-lived refresh token (run scripts/get-google-token.ts once)
 *
 * Setup: see scripts/get-google-token.ts for one-time token generation
 */

import { google, sheets_v4 } from "googleapis";

export interface TestCase {
  id: string;
  category: string;
  title: string;
  steps: string;        // newline-separated steps
  expectedResult: string;
  priority: "High" | "Medium" | "Low";
  status: "Not Run" | "Pass" | "Fail" | "Skip";
  notes: string;
}

// Column order in the sheet
const COLUMNS = ["ID", "Category", "Title", "Steps", "Expected Result", "Priority", "Status", "Notes"];

// ── Auth ──────────────────────────────────────────────────────
function getAuth() {
  const clientId     = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      "Google Sheets 환경변수 미설정: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN\n" +
      "scripts/get-google-token.ts 를 실행해서 토큰을 발급받으세요."
    );
  }

  const oauth2 = new google.auth.OAuth2(clientId, clientSecret);
  oauth2.setCredentials({ refresh_token: refreshToken });
  return oauth2;
}

function getSheetsClient(): sheets_v4.Sheets {
  return google.sheets({ version: "v4", auth: getAuth() });
}

// ── Read all rows from a sheet tab ────────────────────────────
export async function readSheet(
  sheetId: string,
  tabName = "TestCases"
): Promise<TestCase[]> {
  const sheets = getSheetsClient();
  const range = `${tabName}!A2:H`;

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range,
  });

  const rows = res.data.values ?? [];
  return rows.map((row) => ({
    id: row[0] ?? "",
    category: row[1] ?? "",
    title: row[2] ?? "",
    steps: row[3] ?? "",
    expectedResult: row[4] ?? "",
    priority: (row[5] as TestCase["priority"]) ?? "Medium",
    status: (row[6] as TestCase["status"]) ?? "Not Run",
    notes: row[7] ?? "",
  }));
}

// ── Ensure the header row exists, create tab if needed ────────
async function ensureHeader(sheets: sheets_v4.Sheets, sheetId: string, tabName: string) {
  // Check if tab exists
  const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
  const exists = meta.data.sheets?.some(
    (s) => s.properties?.title === tabName
  );

  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: {
        requests: [{ addSheet: { properties: { title: tabName } } }],
      },
    });
  }

  // Write header if A1 is empty
  const header = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `${tabName}!A1:H1`,
  });

  if (!header.data.values?.length) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `${tabName}!A1`,
      valueInputOption: "RAW",
      requestBody: { values: [COLUMNS] },
    });
  }
}

// ── Append test cases to a sheet tab ─────────────────────────
export async function appendTestCases(
  sheetId: string,
  testCases: TestCase[],
  tabName = "TestCases"
): Promise<number> {
  const sheets = getSheetsClient();
  await ensureHeader(sheets, sheetId, tabName);

  const rows = testCases.map((tc) => [
    tc.id,
    tc.category,
    tc.title,
    tc.steps,
    tc.expectedResult,
    tc.priority,
    tc.status,
    tc.notes,
  ]);

  await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId,
    range: `${tabName}!A1`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: rows },
  });

  return rows.length;
}

// ── Update a single row by ID ─────────────────────────────────
export async function updateTestCaseStatus(
  sheetId: string,
  testCaseId: string,
  status: TestCase["status"],
  notes: string,
  tabName = "TestCases"
): Promise<boolean> {
  const sheets = getSheetsClient();
  const range = `${tabName}!A2:H`;

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range,
  });

  const rows = res.data.values ?? [];
  const rowIndex = rows.findIndex((r) => r[0] === testCaseId);
  if (rowIndex === -1) return false;

  const sheetRow = rowIndex + 2; // +1 for header, +1 for 1-based index
  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: `${tabName}!G${sheetRow}:H${sheetRow}`,
    valueInputOption: "RAW",
    requestBody: { values: [[status, notes]] },
  });

  return true;
}

// ── Overwrite all rows (full sync) ────────────────────────────
export async function writeAllTestCases(
  sheetId: string,
  testCases: TestCase[],
  tabName = "TestCases"
): Promise<void> {
  const sheets = getSheetsClient();
  await ensureHeader(sheets, sheetId, tabName);

  // Clear existing data rows
  await sheets.spreadsheets.values.clear({
    spreadsheetId: sheetId,
    range: `${tabName}!A2:H`,
  });

  if (testCases.length === 0) return;

  const rows = testCases.map((tc) => [
    tc.id,
    tc.category,
    tc.title,
    tc.steps,
    tc.expectedResult,
    tc.priority,
    tc.status,
    tc.notes,
  ]);

  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: `${tabName}!A2`,
    valueInputOption: "RAW",
    requestBody: { values: rows },
  });
}
