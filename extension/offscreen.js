// Records tab audio (+ mic) and optionally the tab's video, keeps the audio on this computer and registers the meeting.
// Offscreen documents only get chrome.runtime, so the server URL and token arrive with the start message.
let session = null; // { recorders, ctx, streams, opts }
let pendingKey = null; // saved recording whose meeting isn't on the server yet
let conn = null; // { server, token }

const toBackground = (msg) => chrome.runtime.sendMessage({ target: "background", ...msg });

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg.target !== "offscreen") return;
  if (msg.type === "start") {
    start(msg).then(reply, (e) => reply({ ok: false, error: e.message }));
    return true;
  }
  if (msg.type === "stop") stop(msg.title);
  if (msg.type === "retry" && pendingKey) register(pendingKey);
  if (msg.type === "discard" && pendingKey) {
    deleteRecording(pendingKey);
    pendingKey = null;
  }
  reply({ ok: true });
});

// Records until stopped; resolves with the whole recording
function record(stream, options) {
  const rec = new MediaRecorder(stream, options);
  const chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const done = new Promise((resolve) => (rec.onstop = () => resolve(new Blob(chunks, { type: rec.mimeType }))));
  rec.start(10_000);
  return { rec, done };
}

const pickType = (types) => types.find((t) => MediaRecorder.isTypeSupported(t));

async function start({ streamId, useMic, useVideo, keepCopy, server, token }) {
  conn = { server, token };
  const source = { chromeMediaSource: "tab", chromeMediaSourceId: streamId };
  // One call for both: the stream id can only be used once
  const tab = await navigator.mediaDevices.getUserMedia({
    audio: { mandatory: source },
    video: useVideo ? { mandatory: { ...source, maxWidth: 1280, maxHeight: 720, maxFrameRate: 24 } } : false,
  });
  // Mic works only after it was allowed once on the extension's mic page
  const mic = useMic ? await navigator.mediaDevices.getUserMedia({ audio: true }).catch(() => null) : null;

  const ctx = new AudioContext();
  const dest = ctx.createMediaStreamDestination();
  const tabSrc = ctx.createMediaStreamSource(new MediaStream(tab.getAudioTracks()));
  tabSrc.connect(dest);
  tabSrc.connect(ctx.destination); // capturing mutes the tab — play it back so you still hear the meeting
  if (mic) ctx.createMediaStreamSource(mic).connect(dest);

  // Audio-only file for summaries (small and cheap for Gemini); screen video is a separate file for you
  const recorders = {
    audio: record(dest.stream, { mimeType: pickType(["audio/webm;codecs=opus", "audio/webm"]), audioBitsPerSecond: 32000 }),
  };
  if (useVideo && tab.getVideoTracks().length) {
    recorders.video = record(new MediaStream([...tab.getVideoTracks(), ...dest.stream.getAudioTracks()]), {
      mimeType: pickType(["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"]),
      videoBitsPerSecond: 1_200_000,
      audioBitsPerSecond: 64000,
    });
  }
  session = { recorders, ctx, streams: [tab, ...(mic ? [mic] : [])], keepCopy, startedAt: new Date() };
  tab.getAudioTracks()[0].onended = () => toBackground({ type: "track-ended" });

  return { ok: true, micOk: !!mic, videoOk: !!recorders.video };
}

// Downloads/Meeting Notes/2026-10-20/14-05 Weekly sync.webm
function filePath(startedAt, title, suffix) {
  const pad = (n) => String(n).padStart(2, "0");
  const day = `${startedAt.getFullYear()}-${pad(startedAt.getMonth() + 1)}-${pad(startedAt.getDate())}`;
  const time = `${pad(startedAt.getHours())}-${pad(startedAt.getMinutes())}`;
  const safe = (title || "Meeting").replace(/[\\/:*?"<>|~.]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 60) || "Meeting";
  return `Meeting Notes/${day}/${time} ${safe}${suffix}.webm`;
}

async function stop(title) {
  if (!session) return;
  const { recorders, ctx, streams, keepCopy, startedAt } = session;
  session = null;
  Object.values(recorders).forEach(({ rec }) => rec.state === "recording" && rec.stop());
  const [audio, video] = await Promise.all([recorders.audio.done, recorders.video?.done]);
  streams.forEach((s) => s.getTracks().forEach((t) => t.stop()));
  ctx.close();

  const name = filePath(startedAt, title, "");
  // The screen video only lives in Downloads (too big to keep inside the extension)
  if (video) toBackground({ type: "save-copy", url: URL.createObjectURL(video), name: filePath(startedAt, title, " (screen)") });

  const key = crypto.randomUUID();
  let savedLocally = true;
  try {
    await saveRecording({ key, meetingId: null, title: title || "", name, blob: audio, createdAt: Date.now() });
  } catch (e) {
    savedLocally = false;
    console.error("Could not save recording locally", e);
  }
  // No copy inside the extension → make sure there's at least the Downloads one
  if (keepCopy || !savedLocally) toBackground({ type: "save-copy", url: URL.createObjectURL(audio), name });
  pendingKey = key;
  register(key, title);
}

// Create the meeting on the server (no audio is sent) and link it to the saved recording
async function register(key, title) {
  try {
    const saved = await getRecording(key).catch(() => null);
    const res = await fetch(`${conn.server}/api/meetings`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-team-token": conn.token },
      body: JSON.stringify({ title: saved?.title ?? title ?? "" }),
    });
    const data = await res.json().catch(() => ({ error: `Server error (${res.status})` }));
    if (!res.ok) throw new Error(data.error || `Server error (${res.status})`);
    if (saved) await saveRecording({ ...saved, meetingId: data.id });
    pendingKey = null;
    toBackground({ type: "uploaded", meeting: data });
  } catch (e) {
    toBackground({ type: "upload-failed", error: e.message || "Could not reach the server" });
  }
}
