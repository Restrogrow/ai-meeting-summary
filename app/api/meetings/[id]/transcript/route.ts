import type { NextRequest } from "next/server";
import { isAuthed, unauthorized } from "@/lib/auth";
import { db } from "@/lib/supabase";
import { readGeminiFile, transcribeMeeting } from "@/lib/meetings";

// Return the saved transcript, or create it from the saved audio on first request
export async function POST(req: NextRequest, ctx: RouteContext<"/api/meetings/[id]/transcript">) {
  if (!isAuthed(req)) return unauthorized();
  const { id } = await ctx.params;
  const { data, error } = await db().from("meetings").select("transcript, audio_path").eq("id", id).single();
  if (error) return Response.json({ error: error.message }, { status: 404 });
  if (data.transcript) return Response.json({ transcript: data.transcript });

  // Extension recordings live on the user's computer: it uploads to Gemini and sends { geminiFile }
  const geminiFile = await readGeminiFile(req);
  if (!geminiFile && !data.audio_path) {
    return Response.json({ error: "The recording is on the computer that recorded it" }, { status: 400 });
  }
  try {
    return Response.json({ transcript: await transcribeMeeting(id, geminiFile) });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Transcript failed" }, { status: 500 });
  }
}
