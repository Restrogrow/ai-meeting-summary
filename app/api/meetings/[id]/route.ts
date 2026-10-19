import type { NextRequest } from "next/server";
import { isAuthed, unauthorized } from "@/lib/auth";
import { db } from "@/lib/supabase";

export async function GET(req: NextRequest, ctx: RouteContext<"/api/meetings/[id]">) {
  if (!isAuthed(req)) return unauthorized();
  const { id } = await ctx.params;
  const { data, error } = await db().from("meetings").select("*").eq("id", id).single();
  if (error) return Response.json({ error: error.message }, { status: 404 });
  return Response.json(data);
}

export async function DELETE(req: NextRequest, ctx: RouteContext<"/api/meetings/[id]">) {
  if (!isAuthed(req)) return unauthorized();
  const { id } = await ctx.params;
  const { error } = await db().from("meetings").delete().eq("id", id);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
