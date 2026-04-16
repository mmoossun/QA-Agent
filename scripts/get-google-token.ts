/**
 * One-time script to get Google OAuth2 refresh token
 *
 * Run once:
 *   npx ts-node scripts/get-google-token.ts
 *
 * Then copy the printed GOOGLE_REFRESH_TOKEN into .env and Render environment variables.
 */

import { google } from "googleapis";
import * as readline from "readline";

const CLIENT_ID     = process.env.GOOGLE_CLIENT_ID     ?? "";
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET ?? "";

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("❌ .env에 GOOGLE_CLIENT_ID 와 GOOGLE_CLIENT_SECRET 를 먼저 설정하세요.");
  process.exit(1);
}

const oauth2 = new google.auth.OAuth2(
  CLIENT_ID,
  CLIENT_SECRET,
  "urn:ietf:wg:oauth:2.0:oob"   // Desktop / out-of-band redirect
);

const authUrl = oauth2.generateAuthUrl({
  access_type: "offline",
  prompt: "consent",             // force refresh_token to be returned
  scope: ["https://www.googleapis.com/auth/spreadsheets"],
});

console.log("\n───────────────────────────────────────────────────");
console.log("1. 아래 URL을 브라우저에서 열어 Google 계정으로 로그인하세요:");
console.log("\n" + authUrl + "\n");
console.log("2. 승인 후 표시되는 코드를 아래에 붙여넣으세요:");
console.log("───────────────────────────────────────────────────\n");

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

rl.question("인증 코드: ", async (code) => {
  rl.close();
  try {
    const { tokens } = await oauth2.getToken(code.trim());
    if (!tokens.refresh_token) {
      console.error("❌ refresh_token 이 반환되지 않았습니다. Google Cloud Console에서 해당 앱의 기존 권한을 취소한 뒤 다시 시도하세요.");
      process.exit(1);
    }
    console.log("\n✅ 성공! 아래 값을 .env 파일과 Render 환경변수에 추가하세요:\n");
    console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}\n`);
  } catch (e) {
    console.error("❌ 토큰 교환 실패:", e);
    process.exit(1);
  }
});
