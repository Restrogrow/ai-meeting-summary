"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type ActionItem = { owner: string; task: string; due: string };
type Meeting = {
  id: number;
  title: string;
  created_at: string;
  overview: string;
  decisions: string[];
  action_items: ActionItem[];
  questions: string[];
  transcript: string;
};
type MeetingRow = Pick<Meeting, "id" | "title" | "created_at">;

const fmtDate = (s: string) =>
  new Date(s).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
const fmtTime = (sec: number) =>
  `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`;

export default function Home() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [meetings, setMeetings] = useState<MeetingRow[]>([]);
  const [selected, setSelected] = useState<Meeting | null>(null);

  const loadList = useCallback(async () => {
    const res = await fetch("/api/meetings");
    if (res.status === 401) return setAuthed(false);
    setAuthed(true);
    if (res.ok) setMeetings(await res.json());
  }, []);

  useEffect(() => {
    loadList();
  }, [loadList]);

  async function openMeeting(id: number) {
    const res = await fetch(`/api/meetings/${id}`);
    if (res.ok) setSelected(await res.json());
  }

  async function deleteMeeting(id: number) {
    await fetch(`/api/meetings/${id}`, { method: "DELETE" });
    setSelected(null);
    loadList();
  }

  async function logout() {
    await fetch("/api/login", { method: "DELETE" });
    setAuthed(false);
  }

  if (authed === null) return <div className="flex-1 grid place-items-center text-zinc-400">Loading…</div>;
  if (!authed) return <Login onDone={loadList} />;

  return (
    <div className="flex-1 flex flex-col md:flex-row min-h-screen bg-zinc-50 text-zinc-900">
      <aside className="md:w-72 md:min-h-screen border-b md:border-b-0 md:border-r border-zinc-200 bg-white flex flex-col">
        <div className="p-4 flex items-center justify-between">
          <h1 className="font-semibold text-lg">📝 Meeting Notes</h1>
          <button onClick={logout} className="text-xs text-zinc-500 hover:text-zinc-900">
            Log out
          </button>
        </div>
        <div className="px-3">
          <button
            onClick={() => setSelected(null)}
            className="w-full rounded-lg bg-indigo-600 text-white py-2 text-sm font-medium hover:bg-indigo-700"
          >
            + New meeting
          </button>
        </div>
        <ul className="p-2 overflow-y-auto max-h-60 md:max-h-none md:flex-1">
          {meetings.length === 0 && <li className="px-3 py-2 text-sm text-zinc-400">No meetings yet</li>}
          {meetings.map((m) => (
            <li key={m.id}>
              <button
                onClick={() => openMeeting(m.id)}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm hover:bg-zinc-100 ${
                  selected?.id === m.id ? "bg-zinc-100" : ""
                }`}
              >
                <div className="font-medium truncate">{m.title}</div>
                <div className="text-xs text-zinc-500">{fmtDate(m.created_at)}</div>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <main className="flex-1 p-4 md:p-8 max-w-4xl w-full mx-auto">
        {selected ? (
          <MeetingView m={selected} onDelete={() => deleteMeeting(selected.id)} />
        ) : (
          <NewMeeting
            onCreated={(m) => {
              setSelected(m);
              loadList();
            }}
          />
        )}
      </main>
    </div>
  );
}

function Login({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (res.ok) onDone();
    else setError("Wrong password");
  }

  return (
    <div className="flex-1 grid place-items-center bg-zinc-50 p-4">
      <form onSubmit={submit} className="w-full max-w-sm bg-white rounded-2xl shadow-sm border border-zinc-200 p-6 space-y-4">
        <h1 className="text-xl font-semibold text-zinc-900">📝 Meeting Notes</h1>
        <p className="text-sm text-zinc-500">Enter the team password to continue.</p>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Team password"
          autoFocus
          className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-zinc-900 outline-none focus:border-indigo-500"
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button className="w-full rounded-lg bg-indigo-600 text-white py-2 font-medium hover:bg-indigo-700">Log in</button>
      </form>
    </div>
  );
}

function NewMeeting({ onCreated }: { onCreated: (m: Meeting) => void }) {
  const [title, setTitle] = useState("");
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const recRef = useRef<MediaRecorder | null>(null);
  const streamsRef = useRef<MediaStream[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function upload(blob: Blob, name: string) {
    setBusy(true);
    setError("");
    const form = new FormData();
    form.append("audio", blob, name);
    form.append("title", title);
    try {
      const res = await fetch("/api/meetings", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Something went wrong");
      onCreated(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  async function start() {
    setError("");
    try {
      // Meet tab audio = everyone else; mic = you
      const display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      if (display.getAudioTracks().length === 0) {
        display.getTracks().forEach((t) => t.stop());
        throw new Error('No audio shared. Pick the Meet tab and turn on "Also share tab audio".');
      }
      const mic = await navigator.mediaDevices.getUserMedia({ audio: true }).catch(() => null);
      streamsRef.current = [display, ...(mic ? [mic] : [])];

      const ctx = new AudioContext();
      const dest = ctx.createMediaStreamDestination();
      ctx.createMediaStreamSource(new MediaStream(display.getAudioTracks())).connect(dest);
      if (mic) ctx.createMediaStreamSource(mic).connect(dest);

      const mimeType = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((t) =>
        MediaRecorder.isTypeSupported(t),
      );
      const rec = new MediaRecorder(dest.stream, { mimeType, audioBitsPerSecond: 32000 });
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.onstop = () => {
        streamsRef.current.forEach((s) => s.getTracks().forEach((t) => t.stop()));
        ctx.close();
        if (timerRef.current) clearInterval(timerRef.current);
        setRecording(false);
        const type = rec.mimeType || "audio/webm";
        upload(new Blob(chunks, { type }), `meeting.${type.includes("mp4") ? "m4a" : "webm"}`);
      };
      // User clicked Chrome's "Stop sharing"
      display.getTracks().forEach((t) => (t.onended = () => rec.state === "recording" && rec.stop()));

      rec.start(10_000);
      recRef.current = rec;
      setSeconds(0);
      setRecording(true);
      timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
    } catch (e) {
      if (e instanceof Error && e.name !== "NotAllowedError") setError(e.message);
    }
  }

  function stop() {
    if (recRef.current?.state === "recording") recRef.current.stop();
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold">New meeting</h2>
        <p className="text-zinc-500 text-sm mt-1">Record a Google Meet call or upload a recording. Gemini writes the notes.</p>
      </div>

      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Meeting title (optional)"
        disabled={recording || busy}
        className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 outline-none focus:border-indigo-500"
      />

      {busy ? (
        <div className="rounded-2xl border border-zinc-200 bg-white p-8 text-center">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-indigo-200 border-t-indigo-600" />
          <p className="mt-4 font-medium">Creating your summary…</p>
          <p className="text-sm text-zinc-500">This takes about 30 seconds to a few minutes, depending on meeting length.</p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-zinc-200 bg-white p-6 space-y-4">
            <h3 className="font-semibold">🎙️ Record live</h3>
            <ol className="text-sm text-zinc-600 list-decimal pl-5 space-y-1">
              <li>Join your Meet in another Chrome tab</li>
              <li>Click Start, choose the <b>Meet tab</b></li>
              <li>Keep <b>&quot;Also share tab audio&quot;</b> on</li>
            </ol>
            {recording ? (
              <button onClick={stop} className="w-full rounded-lg bg-red-600 text-white py-3 font-medium hover:bg-red-700">
                <span className="inline-block h-2 w-2 rounded-full bg-white animate-pulse mr-2" />
                Stop & summarize · {fmtTime(seconds)}
              </button>
            ) : (
              <button onClick={start} className="w-full rounded-lg bg-indigo-600 text-white py-3 font-medium hover:bg-indigo-700">
                Start recording
              </button>
            )}
          </div>

          <label
            className={`rounded-2xl border-2 border-dashed border-zinc-300 bg-white p-6 flex flex-col items-center justify-center text-center gap-2 ${
              recording ? "opacity-50 pointer-events-none" : "cursor-pointer hover:border-indigo-400"
            }`}
          >
            <span className="text-3xl">📁</span>
            <span className="font-semibold">Upload a recording</span>
            <span className="text-sm text-zinc-500">mp4, webm, mp3, m4a, wav</span>
            <input
              type="file"
              accept="audio/*,video/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) upload(f, f.name);
                e.target.value = "";
              }}
            />
          </label>
        </div>
      )}

      {error && <p className="rounded-lg bg-red-50 text-red-700 px-4 py-3 text-sm">{error}</p>}
    </div>
  );
}

function MeetingView({ m, onDelete }: { m: Meeting; onDelete: () => void }) {
  const [copied, setCopied] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);

  function copy() {
    const lines = [
      `*${m.title}* (${fmtDate(m.created_at)})`,
      "",
      m.overview,
      ...(m.decisions.length ? ["", "*Decisions*", ...m.decisions.map((d) => `• ${d}`)] : []),
      ...(m.action_items.length
        ? ["", "*Action items*", ...m.action_items.map((a) => `• ${a.owner}: ${a.task} (due: ${a.due})`)]
        : []),
      ...(m.questions.length ? ["", "*Open questions*", ...m.questions.map((q) => `• ${q}`)] : []),
    ];
    navigator.clipboard.writeText(lines.join("\n"));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <article className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold">{m.title}</h2>
          <p className="text-sm text-zinc-500">{fmtDate(m.created_at)}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={copy} className="rounded-lg bg-indigo-600 text-white px-4 py-2 text-sm font-medium hover:bg-indigo-700">
            {copied ? "Copied ✓" : "Copy summary"}
          </button>
          <button
            onClick={onDelete}
            className="rounded-lg border border-zinc-300 px-4 py-2 text-sm text-zinc-600 hover:bg-red-50 hover:text-red-700 hover:border-red-200"
          >
            Delete
          </button>
        </div>
      </header>

      <Section title="Overview">
        <p className="text-zinc-700 leading-relaxed">{m.overview}</p>
      </Section>

      <Section title={`Action items (${m.action_items.length})`}>
        {m.action_items.length === 0 ? (
          <Empty />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-zinc-500">
                <tr>
                  <th className="py-2 pr-4 font-medium">Who</th>
                  <th className="py-2 pr-4 font-medium">Task</th>
                  <th className="py-2 font-medium">Due</th>
                </tr>
              </thead>
              <tbody>
                {m.action_items.map((a, i) => (
                  <tr key={i} className="border-t border-zinc-100">
                    <td className="py-2 pr-4 font-medium whitespace-nowrap">{a.owner}</td>
                    <td className="py-2 pr-4 text-zinc-700">{a.task}</td>
                    <td className="py-2 text-zinc-500 whitespace-nowrap">{a.due}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <div className="grid gap-6 md:grid-cols-2">
        <Section title="Decisions">
          <List items={m.decisions} />
        </Section>
        <Section title="Open questions">
          <List items={m.questions} />
        </Section>
      </div>

      <Section title="Transcript">
        <button onClick={() => setShowTranscript((s) => !s)} className="text-sm text-indigo-600 hover:underline">
          {showTranscript ? "Hide transcript" : "Show full transcript"}
        </button>
        {showTranscript && (
          <pre className="mt-3 whitespace-pre-wrap font-sans text-sm text-zinc-700 leading-relaxed max-h-[60vh] overflow-y-auto">
            {m.transcript}
          </pre>
        )}
      </Section>
    </article>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-5">
      <h3 className="font-semibold mb-3">{title}</h3>
      {children}
    </section>
  );
}

function List({ items }: { items: string[] }) {
  if (items.length === 0) return <Empty />;
  return (
    <ul className="list-disc pl-5 space-y-1 text-sm text-zinc-700">
      {items.map((d, i) => (
        <li key={i}>{d}</li>
      ))}
    </ul>
  );
}

const Empty = () => <p className="text-sm text-zinc-400">Nothing noted</p>;
