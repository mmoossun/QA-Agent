import * as path from "path";
import * as dotenv from "dotenv";

const root = path.resolve(__dirname, "..");
process.chdir(root);
dotenv.config({ path: path.join(root, ".env") });

async function main() {
  console.log("API Key:", process.env.ANTHROPIC_API_KEY?.slice(0, 25) + "...");

  // Dynamic import AFTER dotenv so env vars are set before module is loaded
  const { chat } = await import("../lib/ai/claude");

  console.log("\nCalling Claude API...");
  try {
    const res = await chat(
      [{ role: "user", content: 'Reply with exactly this JSON: {"status":"ok","model":"working"}' }],
      "You are a test assistant. Always reply with valid JSON only. No explanations.",
      { maxTokens: 100, useCache: false }
    );
    console.log("Claude response:", res);
    console.log("\nAPI KEY IS WORKING!");
  } catch (err) {
    console.error("API call failed:", err);
  }
}

main();
