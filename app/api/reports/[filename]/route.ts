import { NextRequest } from "next/server";
import * as fs from "fs";
import * as path from "path";

export async function GET(
  _req: NextRequest,
  { params }: { params: { filename: string } }
) {
  const filename = params.filename;

  if (filename.includes("..") || filename.includes("/")) {
    return new Response("Not found", { status: 404 });
  }

  const filepath = path.join(process.cwd(), "public", "reports", filename);

  if (!fs.existsSync(filepath)) {
    return new Response("Report not found", { status: 404 });
  }

  const content = fs.readFileSync(filepath, "utf-8");
  return new Response(content, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=86400",
    },
  });
}
