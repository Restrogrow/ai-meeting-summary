import "server-only";
import { BUCKET, db } from "@/lib/supabase";
import { summarizeAudio } from "@/lib/gemini";

// Saved audio → Gemini summary → row marked done (or failed with the reason)
export async function processMeeting(id: number | string) {
  const supabase = db();
  try {
    const { data: row, error } = await supabase.from("meetings").select("audio_path").eq("id", id).single();
    if (error) throw new Error(error.message);
    if (!row.audio_path) throw new Error("No saved audio for this meeting");

    const { data: audio, error: dlError } = await supabase.storage.from(BUCKET).download(row.audio_path);
    if (dlError) throw new Error(`Could not load saved audio: ${dlError.message}`);

    const summary = await summarizeAudio(audio);
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
