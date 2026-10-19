import "server-only";
import { GoogleGenAI, FileState, ThinkingLevel, createPartFromUri, createUserContent } from "@google/genai";

export type ActionItem = { owner: string; task: string; due: string };
export type Summary = {
  overview: string;
  decisions: string[];
  action_items: ActionItem[];
  questions: string[];
};

const SUMMARY_PROMPT = `You are given the audio of a team meeting (it may be in English, Hindi or Hinglish).
In clear, simple English write:
- overview: 3-5 sentences on what the meeting was about and its outcome
- decisions: each decision that was agreed
- action_items: each task with owner (person's name or "Unassigned"), task, and due ("Not specified" if no deadline was said)
- questions: open questions or unresolved points
Only include things that were actually said. Use empty arrays when there is nothing.
If there is no clear speech in the audio, set overview to "No speech was detected in this recording." and leave every list empty — never guess or invent content.`;

const TRANSCRIPT_PROMPT = `You are given the audio of a team meeting (it may be in English, Hindi or Hinglish).
Write a full transcript in the language actually spoken. Label speakers by name when a name is said, otherwise "Speaker 1", "Speaker 2"... Put each turn on its own line as "Name: text".
Output only the transcript, nothing else. If there is no clear speech, output exactly "(No speech detected)" — never invent dialogue.`;

const SCHEMA = {
  type: "object",
  properties: {
    overview: { type: "string" },
    decisions: { type: "array", items: { type: "string" } },
    action_items: {
      type: "array",
      items: {
        type: "object",
        properties: { owner: { type: "string" }, task: { type: "string" }, due: { type: "string" } },
        required: ["owner", "task", "due"],
      },
    },
    questions: { type: "array", items: { type: "string" } },
  },
  required: ["overview", "decisions", "action_items", "questions"],
};

// Keep audio as audio: Gemini fails to process an audio-only webm labelled video/webm
function geminiMime(type: string) {
  return (type || "audio/webm").split(";")[0];
}

// Start a Gemini upload the browser finishes itself, so big recordings never pass through this server.
// The returned URL works without the API key.
export async function startBrowserUpload(mimeType: string, size: number, displayName: string) {
  const res = await fetch("https://generativelanguage.googleapis.com/upload/v1beta/files", {
    method: "POST",
    headers: {
      "x-goog-api-key": process.env.GEMINI_API_KEY!,
      "X-Goog-Upload-Protocol": "resumable",
      "X-Goog-Upload-Command": "start",
      "X-Goog-Upload-Header-Content-Length": String(size),
      "X-Goog-Upload-Header-Content-Type": geminiMime(mimeType),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ file: { display_name: displayName } }),
  });
  const uploadUrl = res.headers.get("x-goog-upload-url");
  if (!res.ok || !uploadUrl) throw new Error(`Gemini upload could not start (${res.status})`);
  return uploadUrl;
}

// Audio is a Blob we upload, or the name ("files/…") of a file the browser already uploaded.
// Upload → one prompt → delete. Low thinking (lowest this model allows): it's billed as output and these tasks don't need it.
async function askAboutAudio(file: Blob | string, prompt: string, config: Record<string, unknown> = {}) {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  let uploaded =
    typeof file === "string"
      ? await ai.files.get({ name: file })
      : await ai.files.upload({ file, config: { mimeType: geminiMime(file.type) } });
  while (uploaded.state === FileState.PROCESSING) {
    await new Promise((r) => setTimeout(r, 2000));
    uploaded = await ai.files.get({ name: uploaded.name! });
  }
  if (uploaded.state === FileState.FAILED) throw new Error("Gemini could not process this audio file");

  try {
    const res = await ai.models.generateContent({
      model: process.env.GEMINI_MODEL || "gemini-flash-latest",
      contents: createUserContent([createPartFromUri(uploaded.uri!, uploaded.mimeType!), prompt]),
      config: { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW }, ...config },
    });
    return res.text ?? "";
  } finally {
    ai.files.delete({ name: uploaded.name! }).catch(() => {});
  }
}

export async function summarizeAudio(file: Blob | string): Promise<Summary> {
  const text = await askAboutAudio(file, SUMMARY_PROMPT, {
    responseMimeType: "application/json",
    responseJsonSchema: SCHEMA,
  });
  return JSON.parse(text || "{}") as Summary;
}

export async function transcribeAudio(file: Blob | string): Promise<string> {
  return (await askAboutAudio(file, TRANSCRIPT_PROMPT)).trim();
}
