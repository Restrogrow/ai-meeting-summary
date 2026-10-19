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
Only include things that were actually said. Use empty arrays when there is nothing.`;

const TRANSCRIPT_PROMPT = `You are given the audio of a team meeting (it may be in English, Hindi or Hinglish).
Write a full transcript in the language actually spoken. Label speakers by name when a name is said, otherwise "Speaker 1", "Speaker 2"... Put each turn on its own line as "Name: text".
Output only the transcript, nothing else.`;

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

// Upload → one prompt → delete. Low thinking (lowest this model allows): it's billed as output and these tasks don't need it.
async function askAboutAudio(file: Blob, prompt: string, config: Record<string, unknown> = {}) {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  let uploaded = await ai.files.upload({ file, config: { mimeType: geminiMime(file.type) } });
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

export async function summarizeAudio(file: Blob): Promise<Summary> {
  const text = await askAboutAudio(file, SUMMARY_PROMPT, {
    responseMimeType: "application/json",
    responseJsonSchema: SCHEMA,
  });
  return JSON.parse(text || "{}") as Summary;
}

export async function transcribeAudio(file: Blob): Promise<string> {
  return (await askAboutAudio(file, TRANSCRIPT_PROMPT)).trim();
}
