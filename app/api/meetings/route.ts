import type { NextRequest } from "next/server";
import { isAuthed, unauthorized } from "@/lib/auth";
import { db } from "@/lib/supabase";
import { summarizeAudio } from "@/lib/gemini";

// List past meetings (newest first)
export async function GET(req: NextRequest) {
  if (!isAuthed(req)) return unauthorized();
  const { data, error } = await db()
    .from("meetings")
    .select("id, title, created_at")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json(data);
}

// Upload audio → Gemini summary → save
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
    const summary = await summarizeAudio(audio);
    const { data, error } = await db()
      .from("meetings")
      .insert({ title, ...summary })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return Response.json(data);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Summary failed" }, { status: 500 });
  }
}
