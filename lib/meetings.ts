import "server-only";
import { BUCKET, db } from "@/lib/supabase";
import { summarizeAudio, transcribeAudio } from "@/lib/gemini";
import { readLocal } from "@/lib/local-audio";

// Saved audio: local copy first, then Supabase
async function loadAudio(id: number | string) {
  const supabase = db();
  const { data: row, error } = await supabase.from("meetings").select("audio_path").eq("id", id).single();
  if (error) throw new Error(error.message);
  if (!row.audio_path) throw new Error("No saved audio for this meeting");

  const local = await readLocal(row.audio_path);
  if (local) return local;
  const { data, error: dlError } = await supabase.storage.from(BUCKET).download(row.audio_path);
  if (dlError) throw new Error(`Could not load saved audio: ${dlError.message}`);
  return data;
}

// Saved audio → Gemini summary → row marked done (or failed with the reason)
export async function processMeeting(id: number | string) {
  const supabase = db();
  try {
    const summary = await summarizeAudio(await loadAudio(id));
    const { error: upError } = await supabase
      .from("meetings")
      .update({ ...summary, status: "done", error: null })
      .eq("id", id);
    if (upError) throw new Error(upError.message);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Summary failed";
    console.error(`[meeting ${id}] ${message}`);
    await supabase.from("meetings").update({ status: "failed", error: message }).eq("id", id);
  }
}

// Full transcript only when someone asks for it (it's the costliest part); saved so it's paid for once
export async function transcribeMeeting(id: number | string) {
  const transcript = await transcribeAudio(await loadAudio(id));
  if (!transcript) throw new Error("Gemini returned an empty transcript");
  const { error } = await db().from("meetings").update({ transcript }).eq("id", id);
  if (error) throw new Error(error.message);
  return transcript;
}
