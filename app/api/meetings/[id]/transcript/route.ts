import type { NextRequest } from "next/server";
import { isAuthed, unauthorized } from "@/lib/auth";
import { db } from "@/lib/supabase";
import { transcribeMeeting } from "@/lib/meetings";

// Return the saved transcript, or create it from the saved audio on first request
export async function POST(req: NextRequest, ctx: RouteContext<"/api/meetings/[id]/transcript">) {
  if (!isAuthed(req)) return unauthorized();
  const { id } = await ctx.params;
  const { data, error } = await db().from("meetings").select("transcript").eq("id", id).single();
  if (error) return Response.json({ error: error.message }, { status: 404 });
  if (data.transcript) return Response.json({ transcript: data.transcript });

  try {
    return Response.json({ transcript: await transcribeMeeting(id) });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Transcript failed" }, { status: 500 });
  }
}
