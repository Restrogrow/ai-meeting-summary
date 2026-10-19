// Records tab audio (+ mic), keeps it on this computer and registers the meeting.
// Offscreen documents only get chrome.runtime, so the server URL and token arrive with the start message.
let rec = null;
let ctx = null;
let streams = [];
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

async function start({ streamId, useMic, keepCopy, server, token }) {
  conn = { server, token };
  const tab = await navigator.mediaDevices.getUserMedia({
    audio: { mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: streamId } },
  });
  // Mic works only after it was allowed once on the extension's mic page
  const mic = useMic ? await navigator.mediaDevices.getUserMedia({ audio: true }).catch(() => null) : null;
  streams = [tab, ...(mic ? [mic] : [])];

  ctx = new AudioContext();
  const dest = ctx.createMediaStreamDestination();
  const tabSrc = ctx.createMediaStreamSource(tab);
  tabSrc.connect(dest);
  tabSrc.connect(ctx.destination); // capturing mutes the tab — play it back so you still hear the meeting
  if (mic) ctx.createMediaStreamSource(mic).connect(dest);

  const mimeType = ["audio/webm;codecs=opus", "audio/webm"].find((t) => MediaRecorder.isTypeSupported(t));
  rec = new MediaRecorder(dest.stream, { mimeType, audioBitsPerSecond: 32000 });
  const chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  rec.onstop = async () => {
    streams.forEach((s) => s.getTracks().forEach((t) => t.stop()));
    ctx.close();
    const stamp = new Date().toISOString().slice(0, 16).replace("T", "_").replace(":", "-");
    const name = `meeting-${stamp}.webm`;
    const blob = new Blob(chunks, { type: rec.mimeType || "audio/webm" });
    const key = crypto.randomUUID();
    try {
      await saveRecording({ key, meetingId: null, title: rec.title || "", name, blob, createdAt: Date.now() });
    } catch (e) {
      // Can't keep it in the extension — make sure there's at least the Downloads copy
      keepCopy = true;
      console.error("Could not save recording locally", e);
    }
    if (keepCopy) toBackground({ type: "save-copy", url: URL.createObjectURL(blob), name });
    pendingKey = key;
    register(key);
  };
  tab.getAudioTracks()[0].onended = () => toBackground({ type: "track-ended" });

  rec.start(10_000);
  return { ok: true, micOk: !!mic };
}

function stop(title) {
  if (rec?.state !== "recording") return;
  rec.title = title; // read by onstop
  rec.stop();
}

// Create the meeting on the server (no audio is sent) and link it to the saved recording
async function register(key) {
  try {
    const saved = await getRecording(key);
    const res = await fetch(`${conn.server}/api/meetings`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-team-token": conn.token },
      body: JSON.stringify({ title: saved?.title || "" }),
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
