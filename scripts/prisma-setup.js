/**
 * DATABASE_URL 형식에 따라 prisma/schema.prisma의 provider를 자동 전환
 * - file:      → sqlite  (로컬 개발)
 * - postgresql / postgres → postgresql  (Render, Supabase 등 프로덕션)
 */
const fs   = require("fs");
const path = require("path");

const url      = process.env.DATABASE_URL ?? "";
const isPostgres = url.startsWith("postgresql") || url.startsWith("postgres");
const provider = isPostgres ? "postgresql" : "sqlite";

const schemaPath = path.join(__dirname, "..", "prisma", "schema.prisma");
let schema = fs.readFileSync(schemaPath, "utf8");
schema = schema.replace(
  /provider\s*=\s*"(?:sqlite|postgresql)"/,
  `provider = "${provider}"`
);
fs.writeFileSync(schemaPath, schema);
console.log(`[prisma-setup] provider = ${provider}  (DATABASE_URL: ${url.slice(0, 30)}...)`);
