import type { NextRequest } from "next/server";
import { isAuthed, unauthorized } from "@/lib/auth";
import { startBrowserUpload } from "@/lib/gemini";

// One-time Gemini upload URL for the extension, so recordings skip this server (and Vercel's body limit)
export async function POST(req: NextRequest) {
  if (!isAuthed(req)) return unauthorized();
  const { mimeType, size, name } = await req.json().catch(() => ({}));
  if (!Number.isFinite(size) || size <= 0) return Response.json({ error: "Missing file size" }, { status: 400 });
  try {
    const uploadUrl = await startBrowserUpload(String(mimeType || "audio/webm"), size, String(name || "meeting"));
    return Response.json({ uploadUrl });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Upload could not start" }, { status: 500 });
  }
}
