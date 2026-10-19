import { after, type NextRequest } from "next/server";
import { isAuthed, unauthorized } from "@/lib/auth";
import { BUCKET, db, ensureBucket } from "@/lib/supabase";
import { processMeeting } from "@/lib/meetings";

// List past meetings (newest first)
export async function GET(req: NextRequest) {
  if (!isAuthed(req)) return unauthorized();
  const { data, error } = await db()
    .from("meetings")
    .select("id, title, created_at, status")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json(data);
}

// Save audio → create meeting (processing) → summarize in the background
export async function POST(req: NextRequest) {
  if (!isAuthed(req)) return unauthorized();
  if (!process.env.GEMINI_API_KEY) {
    return Response.json({ error: "GEMINI_API_KEY is not set on the server" }, { status: 500 });
  }

  const form = await req.formData();
  const audio = form.get("audio");
  if (!(audio instanceof File) || audio.size === 0) {
    return Response.json({ error: "No audio received" }, { status: 400 });
  }
  const title =
    String(form.get("title") ?? "").trim() ||
    `Meeting – ${new Date().toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" })}`;

  try {
    await ensureBucket();
    const ext = audio.name.split(".").pop()?.toLowerCase() || "webm";
    const audioPath = `${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.${ext}`;
    const { error: upError } = await db()
      .storage.from(BUCKET)
      .upload(audioPath, audio, { contentType: audio.type || "audio/webm" });
    if (upError) throw new Error(`Could not save audio: ${upError.message}`);

    const { data, error } = await db()
      .from("meetings")
      .insert({ title, status: "processing", audio_path: audioPath })
      .select()
      .single();
    if (error) throw new Error(error.message);

    after(() => processMeeting(data.id));
    return Response.json(data);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Upload failed" }, { status: 500 });
  }
}
