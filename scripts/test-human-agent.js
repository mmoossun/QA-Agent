#!/usr/bin/env node
/**
 * Human Agent live test — pure CommonJS, no tsx needed
 * Usage: node scripts/test-human-agent.js
 */
"use strict";
const http = require("http");
const path = require("path");

// Load .env
try {
  const fs = require("fs");
  const envPath = path.join(__dirname, "../.env");
  const envContent = fs.readFileSync(envPath, "utf8");
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^"|"$/g, "");
    if (!process.env[key]) process.env[key] = val;
  }
  console.log("[ENV] .env loaded");
} catch (e) {
  console.log("[ENV] .env not found, using system env");
}

const TARGET_SCORE = 95;
const CONFIG = {
  targetUrl:     "https://app-dev.generativelab.co.kr",
  goal:          "로그인 후 채팅 목록을 확인하고 첫 번째 채팅방에 입장해 메시지를 확인해줘",
  loginEmail:    "qa-owner@example.com",
  loginPassword: "TestPassword123",
  maxSteps:      15,
  categories:    ["기능 테스트", "UI/UX"],
};

function score(result) {
  let raw = 0;
  let consec = 0, maxFails = 0;
  const steps = result.steps || [];
  for (const s of steps) {
    if (s.success) { raw += 5; consec = 0; }
    else { raw -= 2; consec++; maxFails = Math.max(maxFails, consec); }
  }
  if (result.status === "done") raw += 15;
  else if (result.status === "max_steps") raw += 5;
  else raw -= 10;
  if (maxFails === 0) raw += 5;
  else if (maxFails <= 1) raw += 2;
  const avgMs = result.totalDurationMs / Math.max(steps.length, 1);
  if (avgMs < 15000) raw += 5;
  else if (avgMs < 25000) raw += 2;
  const maxRaw = steps.length * 5 + 25;
  return { score: Math.round(Math.max(0, Math.min(100, raw / maxRaw * 100))), maxFails, avgMs };
}

async function run() {
  console.log("\n" + "=".repeat(60));
  console.log("  HUMAN AGENT v4 TEST  |  Target: " + TARGET_SCORE + "/100");
  console.log("=".repeat(60));
  console.log("URL:  " + CONFIG.targetUrl);
  console.log("Goal: " + CONFIG.goal);
  console.log("Steps: max " + CONFIG.maxSteps);
  console.log("");

  const startTime = Date.now();
  const body = JSON.stringify(CONFIG);
  let finalResult = null;
  let errorMsg = "";

  await new Promise((resolve, reject) => {
    const req = http.request({
      hostname: "localhost",
      port: 3000,
      path: "/api/human-agent/run",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
    }, (res) => {
      console.log("[HTTP] " + res.statusCode);
      let buf = "";
      res.on("data", (chunk) => {
        buf += chunk.toString("utf8");
        const lines = buf.split("\n");
        buf = lines.pop() || "";
        for (const line of lines) {
          if (line.startsWith(": ")) continue; // keep-alive comment
          if (!line.startsWith("data: ")) continue;
          try {
            const evt = JSON.parse(line.slice(6));
            if (evt.type === "start" || evt.type === "info") {
              console.log("[INFO] " + evt.message);
            } else if (evt.type === "step") {
              const s = evt.step;
              const ok = s.success ? "OK  " : "FAIL";
              const dur = (s.durationMs / 1000).toFixed(1) + "s";
              const plan = (s.planningMs / 1000).toFixed(1) + "s";
              const perc = (s.perceptionMs / 1000).toFixed(1) + "s";
              const desc = (s.decision.description || "").slice(0, 52);
              const err = s.error ? " | ERR:" + s.error.slice(0, 40) : "";
              console.log(
                "  [" + ok + "] Step " + String(s.stepNumber).padStart(2) +
                " [" + (s.decision.action || "").padEnd(8) + "] " +
                desc.padEnd(53) + " " + dur +
                " plan:" + plan + " perc:" + perc + err
              );
            } else if (evt.type === "complete") {
              finalResult = evt.result;
            } else if (evt.type === "error") {
              errorMsg = evt.message;
              console.log("[ERROR] " + evt.message);
            }
          } catch (_) { /* ignore parse errors */ }
        }
      });
      res.on("end", resolve);
      res.on("error", reject);
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log("\n" + "=".repeat(60));

  if (!finalResult) {
    console.log("NO RESULT received." + (errorMsg ? " Error: " + errorMsg : ""));
    process.exit(1);
  }

  const r = finalResult;
  const { score: s, maxFails, avgMs } = score(r);
  const passed = (r.steps || []).filter(x => x.success).length;
  const total = (r.steps || []).length;

  console.log("STATUS:      " + r.status.toUpperCase());
  console.log("SCORE:       " + s + " / 100   (target: " + TARGET_SCORE + ")");
  console.log("PASS RATE:   " + (total ? (passed / total * 100).toFixed(1) : 0) + "%  (" + passed + "/" + total + " steps)");
  console.log("AVG/STEP:    " + (avgMs / 1000).toFixed(1) + "s");
  console.log("TOTAL TIME:  " + (r.totalDurationMs / 1000).toFixed(1) + "s  (" + elapsed + "s incl. API overhead)");
  console.log("MAX CONSEC FAIL: " + maxFails);
  console.log("SUMMARY:     " + r.summary);

  const failedSteps = (r.steps || []).filter(x => !x.success);
  if (failedSteps.length > 0) {
    console.log("\n-- Failed Steps --");
    for (const s of failedSteps) {
      console.log("  Step " + s.stepNumber + " [" + s.decision.action + "] " + s.decision.description);
      console.log("    => " + (s.error || "unknown error"));
    }
  }

  console.log("\n" + "=".repeat(60));
  if (s >= TARGET_SCORE) {
    console.log("RESULT: TARGET ACHIEVED " + s + " >= " + TARGET_SCORE + " -- PASS");
    process.exit(0);
  } else {
    console.log("RESULT: TARGET MISSED " + s + " < " + TARGET_SCORE + " (gap: " + (TARGET_SCORE - s) + ")");
    process.exit(1);
  }
}

run().catch((e) => {
  console.error("Test failed:", e.message);
  process.exit(1);
});
