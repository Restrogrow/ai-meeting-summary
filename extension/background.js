importScripts("api.js", "db.js");

// Summary/transcript jobs in flight, so a reopened popup shows them: { [meetingId]: "summary" | "transcript" }
async function setJob(id, job) {
  const { jobs = {} } = await chrome.storage.session.get("jobs");
  if (job) jobs[id] = job;
  else delete jobs[id];
  await chrome.storage.session.set({ jobs });
}

// Local recording → straight to Gemini (the server only hands out the upload URL) → "files/…" name
async function uploadToGemini(meetingId) {
  const saved = await getRecordingFor(meetingId);
  if (!saved) throw Object.assign(new Error("The recording isn't on this computer"), { code: "no-local" });
  const { uploadUrl } = await api("/api/gemini-upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mimeType: saved.blob.type, size: saved.blob.size, name: saved.name }),
  });
  const res = await fetch(uploadUrl, {
    method: "POST",
    headers: { "X-Goog-Upload-Offset": "0", "X-Goog-Upload-Command": "upload, finalize" },
    body: saved.blob,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.file?.name) throw new Error(data.error?.message || `Upload to Gemini failed (${res.status})`);
  return data.file.name;
}

async function runJob(meetingId, job) {
  await setJob(meetingId, job);
  try {
    const geminiFile = await uploadToGemini(meetingId);
    const path = job === "summary" ? `/api/meetings/${meetingId}` : `/api/meetings/${meetingId}/transcript`;
    return await api(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ geminiFile }),
    });
  } finally {
    await setJob(meetingId, null);
  }
}

// Recording state lives in session storage so the popup can show it after reopening:
// { phase: "idle" | "recording" | "uploading" | "failed", startedAt, title, tabId, error, meetingId }
const setState = (state) => chrome.storage.session.set({ rec: state });
const getState = async () => (await chrome.storage.session.get({ rec: { phase: "idle" } })).rec;

async function ensureOffscreen() {
  if (await chrome.offscreen.hasDocument()) return;
  await chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: ["USER_MEDIA"],
    justification: "Record the meeting tab's audio and the microphone",
  });
}

function badge(text, color) {
  chrome.action.setBadgeText({ text });
  if (color) chrome.action.setBadgeBackgroundColor({ color });
}

async function startRecording(tabId, title) {
  const cur = await getState();
  if (cur.phase === "recording" || cur.phase === "uploading") throw new Error("Already recording");
  const { server, token, useMic, keepCopy } = await getSettings();
  if (!token) throw new Error("Log in first (open the extension popup)");

  const tab = await chrome.tabs.get(tabId);
  const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
  await ensureOffscreen();
  const res = await chrome.runtime.sendMessage({
    target: "offscreen",
    type: "start",
    streamId,
    useMic,
    keepCopy,
    server,
    token,
  });
  if (!res?.ok) throw new Error(res?.error || "Could not start recording");

  await setState({ phase: "recording", startedAt: Date.now(), title: title || "", tabId, tabTitle: tab.title, micOk: res.micOk });
  badge("REC", "#dc2626");
  return { micOk: res.micOk };
}

async function stopRecording() {
  const cur = await getState();
  if (cur.phase !== "recording") return;
  await setState({ ...cur, phase: "uploading" });
  badge("…", "#4f46e5");
  chrome.runtime.sendMessage({ target: "offscreen", type: "stop", title: cur.title });
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg.target !== "background") return;
  (async () => {
    const cur = await getState();
    switch (msg.type) {
      case "start":
        return startRecording(msg.tabId, msg.title);
      case "stop":
        return stopRecording();
      case "summarize":
        await runJob(msg.meetingId, "summary");
        return;
      case "transcript":
        return { transcript: (await runJob(msg.meetingId, "transcript")).transcript };
      case "retry-upload":
        await setState({ ...cur, phase: "uploading", error: "" });
        badge("…", "#4f46e5");
        chrome.runtime.sendMessage({ target: "offscreen", type: "retry", title: cur.title });
        return;
      case "discard":
        await chrome.runtime.sendMessage({ target: "offscreen", type: "discard" }).catch(() => {});
        await chrome.offscreen.closeDocument().catch(() => {});
        await setState({ phase: "idle" });
        badge("");
        return;
      // From offscreen
      case "track-ended": // Meet tab closed or capture stopped
        return stopRecording();
      case "save-copy":
        chrome.downloads.download({ url: msg.url, filename: msg.name, saveAs: false });
        return;
      case "uploaded":
        await setState({ phase: "idle", lastMeetingId: msg.meeting.id });
        badge(""); // offscreen stays open so the Downloads copy (a blob URL there) can finish
        chrome.notifications.create({
          type: "basic",
          iconUrl: "icons/128.png",
          title: "Recording saved on this computer",
          message: `${msg.meeting.title} — open Meeting Notes to create the summary.`,
        });
        return;
      case "upload-failed":
        await setState({ ...cur, phase: "failed", error: msg.error });
        badge("!", "#dc2626");
        chrome.notifications.create({
          type: "basic",
          iconUrl: "icons/128.png",
          title: "Meeting not added to the list",
          message: `${msg.error} — the recording is safe on this computer; open the extension to retry.`,
        });
        return;
    }
  })().then(
    (data) => reply({ ok: true, ...(data || {}) }),
    (e) => reply({ ok: false, error: e.message, code: e.code }),
  );
  return true;
});

// Alt+Shift+R: start on the current tab, or stop
chrome.commands.onCommand.addListener(async (cmd, tab) => {
  if (cmd !== "toggle-recording") return;
  const cur = await getState();
  try {
    if (cur.phase === "recording") await stopRecording();
    else if (cur.phase === "idle" && tab?.id) await startRecording(tab.id, "");
  } catch (e) {
    chrome.notifications.create({ type: "basic", iconUrl: "icons/128.png", title: "Meeting Notes", message: e.message });
  }
});

// After a browser/extension restart the offscreen recorder is gone
chrome.runtime.onStartup.addListener(async () => {
  const cur = await getState();
  if (cur.phase !== "idle" && !(await chrome.offscreen.hasDocument())) {
    await setState({ phase: "idle" });
    badge("");
  }
});
