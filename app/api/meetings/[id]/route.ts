import { after, type NextRequest } from "next/server";
import { isAuthed, unauthorized } from "@/lib/auth";
import { BUCKET, db } from "@/lib/supabase";
import { processMeeting, readGeminiFile } from "@/lib/meetings";
import { removeLocal } from "@/lib/local-audio";

export async function GET(req: NextRequest, ctx: RouteContext<"/api/meetings/[id]">) {
  if (!isAuthed(req)) return unauthorized();
  const { id } = await ctx.params;
  const { data, error } = await db().from("meetings").select("*").eq("id", id).single();
  if (error) return Response.json({ error: error.message }, { status: 404 });
  return Response.json({ ...data, audio_url: data.audio_path ? `/api/meetings/${id}/audio` : null });
}

// Create (or retry) the summary — only ever on request. From the saved audio, or from
// { geminiFile } that the extension uploaded straight to Gemini.
export async function POST(req: NextRequest, ctx: RouteContext<"/api/meetings/[id]">) {
  if (!isAuthed(req)) return unauthorized();
  if (!process.env.GEMINI_API_KEY) {
    return Response.json({ error: "GEMINI_API_KEY is not set on the server" }, { status: 500 });
  }
  const { id } = await ctx.params;
  const geminiFile = await readGeminiFile(req);
  let query = db()
    .from("meetings")
    .update({ status: "processing", error: null, summary_requested_at: new Date().toISOString() })
    .eq("id", id);
  if (!geminiFile) query = query.not("audio_path", "is", null);
  const { data, error } = await query.select("id").maybeSingle();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!data) return Response.json({ error: "No saved audio to retry" }, { status: 400 });

  after(() => processMeeting(id, geminiFile));
  return Response.json({ ok: true });
}

export async function DELETE(req: NextRequest, ctx: RouteContext<"/api/meetings/[id]">) {
  if (!isAuthed(req)) return unauthorized();
  const { id } = await ctx.params;
  const { data, error } = await db().from("meetings").delete().eq("id", id).select("audio_path").maybeSingle();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (data?.audio_path) {
    await db().storage.from(BUCKET).remove([data.audio_path]);
    await removeLocal(data.audio_path).catch(() => {});
  }
  return Response.json({ ok: true });
}
