import { NextRequest } from "next/server";
import * as fs from "fs";
import * as path from "path";

export async function GET(
  _req: NextRequest,
  { params }: { params: { filename: string } }
) {
  const filename = params.filename;

  // Prevent path traversal
  if (filename.includes("..") || filename.includes("/")) {
    return new Response("Not found", { status: 404 });
  }

  const filepath = path.join(process.cwd(), "public", "screenshots", filename);

  if (!fs.existsSync(filepath)) {
    return new Response("Screenshot not found", { status: 404 });
  }

  const buffer = fs.readFileSync(filepath);
  return new Response(buffer, {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=86400",
    },
  });
}
