import { after, type NextRequest } from "next/server";
import { isAuthed, unauthorized } from "@/lib/auth";
import { BUCKET, db, ensureBucket } from "@/lib/supabase";
import { processMeeting } from "@/lib/meetings";
import { saveLocal } from "@/lib/local-audio";

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

// Save audio (server disk + Supabase) → create meeting (processing) → summarize in the background
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

  const ext = audio.name.split(".").pop()?.toLowerCase() || "webm";
  const audioPath = `${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.${ext}`;

  // Either copy is enough; only give up if both fail
  let localCopy: string | null = null;
  let localError = "";
  try {
    localCopy = await saveLocal(audioPath, audio);
  } catch (e) {
    localError = e instanceof Error ? e.message : "unknown error";
    console.error(`[upload] local save failed: ${localError}`);
  }

  let cloudError = "";
  try {
    await ensureBucket();
    const { error } = await db()
      .storage.from(BUCKET)
      .upload(audioPath, audio, { contentType: audio.type || "audio/webm" });
    if (error) throw new Error(error.message);
  } catch (e) {
    cloudError = e instanceof Error ? e.message : "unknown error";
    console.error(`[upload] Supabase storage failed (local copy: ${localCopy ?? "none"}): ${cloudError}`);
  }

  if (!localCopy && cloudError) {
    return Response.json(
      { error: `Could not save audio. Server disk: ${localError}. Supabase: ${cloudError}` },
      { status: 500 },
    );
  }

  const { data, error } = await db()
    .from("meetings")
    .insert({ title, status: "processing", audio_path: audioPath })
    .select()
    .single();
  if (error) {
    const where = localCopy ? ` The recording is saved on the server at ${localCopy}.` : "";
    return Response.json({ error: `Could not create the meeting: ${error.message}.${where}` }, { status: 500 });
  }

  after(() => processMeeting(data.id));
  return Response.json(data);
}
