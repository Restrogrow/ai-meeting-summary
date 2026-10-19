import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import type { NextRequest } from "next/server";
import { isAuthed, unauthorized } from "@/lib/auth";
import { BUCKET, db } from "@/lib/supabase";
import { localFile, localSize, mimeFor } from "@/lib/local-audio";

// Stream the recording: server-disk copy if present (with seeking), else Supabase
export async function GET(req: NextRequest, ctx: RouteContext<"/api/meetings/[id]/audio">) {
  if (!isAuthed(req)) return unauthorized();
  const { id } = await ctx.params;
  const { data, error } = await db().from("meetings").select("title, audio_path").eq("id", id).single();
  if (error || !data?.audio_path) return Response.json({ error: "No recording" }, { status: 404 });

  const ext = data.audio_path.split(".").pop();
  const filename = `${data.title.replace(/[^\w\- ]+/g, "").trim() || "meeting"}.${ext}`;
  const download = req.nextUrl.searchParams.has("download");

  const size = await localSize(data.audio_path);
  if (size === null) {
    const { data: signed, error: signError } = await db()
      .storage.from(BUCKET)
      .createSignedUrl(data.audio_path, 60 * 60, download ? { download: filename } : undefined);
    if (signError) return Response.json({ error: `Recording not found: ${signError.message}` }, { status: 404 });
    return Response.redirect(signed.signedUrl, 302);
  }

  let start = 0;
  let end = size - 1;
  let status = 200;
  const range = req.headers.get("range")?.match(/^bytes=(\d*)-(\d*)$/);
  if (range && (range[1] || range[2])) {
    if (range[1]) {
      start = Number(range[1]);
      if (range[2]) end = Math.min(Number(range[2]), size - 1);
    } else {
      start = Math.max(size - Number(range[2]), 0);
    }
    if (start > end) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    status = 206;
  }

  const body = Readable.toWeb(createReadStream(localFile(data.audio_path), { start, end })) as ReadableStream;
  return new Response(body, {
    status,
    headers: {
      "Content-Type": mimeFor(data.audio_path),
      "Content-Length": String(end - start + 1),
      "Accept-Ranges": "bytes",
      ...(status === 206 && { "Content-Range": `bytes ${start}-${end}/${size}` }),
      ...(download && { "Content-Disposition": `attachment; filename="${filename}"` }),
      "Cache-Control": "private, no-store",
    },
  });
}
