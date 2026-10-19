import "server-only";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

// Copy of every recording on the server's own disk, so Supabase is never the only copy
const ROOT = path.resolve(process.env.RECORDINGS_DIR || "recordings");

const MIME: Record<string, string> = {
  webm: "audio/webm",
  m4a: "audio/mp4",
  mp4: "video/mp4",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  aac: "audio/aac",
  flac: "audio/flac",
  mov: "video/quicktime",
};
export const mimeFor = (p: string) => MIME[p.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";

export function localFile(audioPath: string) {
  const full = path.resolve(ROOT, audioPath);
  if (!full.startsWith(ROOT + path.sep)) throw new Error("Invalid audio path");
  return full;
}

export async function saveLocal(audioPath: string, audio: Blob) {
  const file = localFile(audioPath);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, Buffer.from(await audio.arrayBuffer()));
  return path.relative(process.cwd(), file);
}

export async function readLocal(audioPath: string): Promise<Blob | null> {
  try {
    return new Blob([await readFile(localFile(audioPath))], { type: mimeFor(audioPath) });
  } catch {
    return null;
  }
}

export async function localSize(audioPath: string) {
  try {
    return (await stat(localFile(audioPath))).size;
  } catch {
    return null;
  }
}

export async function removeLocal(audioPath: string) {
  await rm(localFile(audioPath), { force: true });
}
