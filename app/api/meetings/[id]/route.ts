import { after, type NextRequest } from "next/server";
import { isAuthed, unauthorized } from "@/lib/auth";
import { BUCKET, db } from "@/lib/supabase";
import { processMeeting } from "@/lib/meetings";

export async function GET(req: NextRequest, ctx: RouteContext<"/api/meetings/[id]">) {
  if (!isAuthed(req)) return unauthorized();
  const { id } = await ctx.params;
  const supabase = db();
  const { data, error } = await supabase.from("meetings").select("*").eq("id", id).single();
  if (error) return Response.json({ error: error.message }, { status: 404 });

  let audio_url: string | null = null;
  if (data.audio_path) {
    const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrl(data.audio_path, 60 * 60 * 6);
    audio_url = signed?.signedUrl ?? null;
  }
  return Response.json({ ...data, audio_url });
}

// Retry the summary from the saved audio
export async function POST(req: NextRequest, ctx: RouteContext<"/api/meetings/[id]">) {
  if (!isAuthed(req)) return unauthorized();
  const { id } = await ctx.params;
  const { data, error } = await db()
    .from("meetings")
    .update({ status: "processing", error: null })
    .eq("id", id)
    .not("audio_path", "is", null)
    .select("id")
    .maybeSingle();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!data) return Response.json({ error: "No saved audio to retry" }, { status: 400 });

  after(() => processMeeting(id));
  return Response.json({ ok: true });
}

export async function DELETE(req: NextRequest, ctx: RouteContext<"/api/meetings/[id]">) {
  if (!isAuthed(req)) return unauthorized();
  const { id } = await ctx.params;
  const { data, error } = await db().from("meetings").delete().eq("id", id).select("audio_path").maybeSingle();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (data?.audio_path) await db().storage.from(BUCKET).remove([data.audio_path]);
  return Response.json({ ok: true });
}
