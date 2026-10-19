const $ = (id) => document.getElementById(id);
const show = (id, on = true) => ($(id).hidden = !on);

const fmtDate = (s) => new Date(s).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
const fmtTime = (sec) => `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`;
const toBg = (msg) => chrome.runtime.sendMessage({ target: "background", ...msg });

// Small DOM builder so server text is never parsed as HTML
function el(tag, props = {}, ...kids) {
  const n = Object.assign(document.createElement(tag), props);
  n.append(...kids.flat().filter((k) => k !== null && k !== undefined && k !== false));
  return n;
}

let currentTab = null;
let timerId = null;
let pollId = null;

function view(name) {
  for (const v of ["login", "main", "detail"]) show(v, v === name);
  if (name !== "detail") clearInterval(pollId);
}

// ---------- Login / settings ----------
async function openSettings(errorText = "") {
  const s = await getSettings();
  $("server").value = s.server;
  $("password").value = "";
  show("loginError", !!errorText);
  $("loginError").textContent = errorText;
  show("logoutBtn", !!s.token);
  view("login");
  $("password").focus();
}

$("loginBtn").onclick = async () => {
  let server = $("server").value.trim().replace(/\/+$/, "") || DEFAULT_SERVER;
  if (!/^https?:\/\//.test(server)) server = "https://" + server;
  let origin;
  try {
    origin = new URL(server).origin;
  } catch {
    return showLoginError("That server URL doesn't look right");
  }
  // Must run straight from the click, before any other await
  const granted = await chrome.permissions.request({ origins: [origin + "/*"] }).catch(() => false);
  if (!granted && !/^http:\/\/(localhost|127\.0\.0\.1)/.test(origin)) {
    return showLoginError("Allow access to the server so the extension can reach it");
  }
  $("loginBtn").disabled = true;
  try {
    const res = await fetch(server + "/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: $("password").value, wantToken: true }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Server error (${res.status})`);
    if (!data.token) throw new Error("Server is on an older version — update the app first");
    await chrome.storage.local.set({ server, token: data.token });
    await openMain();
  } catch (e) {
    showLoginError(e.message === "Failed to fetch" ? `Can't reach ${server} — is the app running?` : e.message);
  } finally {
    $("loginBtn").disabled = false;
  }
};
$("password").onkeydown = (e) => e.key === "Enter" && $("loginBtn").click();

function showLoginError(text) {
  $("loginError").textContent = text;
  show("loginError");
}

$("logoutBtn").onclick = async () => {
  await chrome.storage.local.set({ token: "" });
  openSettings();
};
$("settingsBtn").onclick = () => openSettings();
$("openApp").onclick = async () => chrome.tabs.create({ url: (await getSettings()).server });

// ---------- Main ----------
async function openMain() {
  view("main");
  await renderRecorder();
  await loadList();
}

async function renderRecorder() {
  const { rec } = await chrome.storage.session.get({ rec: { phase: "idle" } });
  for (const p of ["Idle", "Live", "Uploading", "Failed"]) show("rec" + p, false);
  clearInterval(timerId);

  if (rec.phase === "recording") {
    show("recLive");
    $("liveTab").textContent = rec.tabTitle ? `Tab: ${rec.tabTitle}` : "";
    show("micWarn", rec.micOk === false && (await getSettings()).useMic);
    const tick = () => ($("timer").textContent = fmtTime(Math.floor((Date.now() - rec.startedAt) / 1000)));
    tick();
    timerId = setInterval(tick, 1000);
  } else if (rec.phase === "uploading") {
    show("recUploading");
  } else if (rec.phase === "failed") {
    show("recFailed");
    $("failMsg").textContent = rec.error || "unknown error";
  } else {
    show("recIdle");
    const s = await getSettings();
    $("useMic").checked = s.useMic;
    $("keepCopy").checked = s.keepCopy;
    [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const url = currentTab?.url || "";
    const isMeet = url.startsWith("https://meet.google.com/");
    const capturable = /^https?:/.test(url);
    $("startBtn").disabled = !capturable;
    $("tabHint").textContent = !capturable
      ? "Open your meeting tab first, then click the extension there."
      : isMeet
        ? `Google Meet tab ready${currentTab.title ? ` · ${currentTab.title}` : ""}`
        : `Will record this tab: ${currentTab.title || url}`;
    await renderMicButton();
  }
}

async function renderMicButton() {
  const useMic = $("useMic").checked;
  const state = await navigator.permissions.query({ name: "microphone" }).then((p) => p.state, () => "prompt");
  show("micBtn", useMic && state !== "granted");
}

$("useMic").onchange = async (e) => {
  await chrome.storage.local.set({ useMic: e.target.checked });
  renderMicButton();
};
$("keepCopy").onchange = (e) => chrome.storage.local.set({ keepCopy: e.target.checked });
$("micBtn").onclick = () => chrome.tabs.create({ url: chrome.runtime.getURL("mic.html") });

$("startBtn").onclick = async () => {
  $("startBtn").disabled = true;
  const res = await toBg({ type: "start", tabId: currentTab.id, title: $("title").value.trim() });
  if (!res?.ok) {
    $("tabHint").textContent = res?.error || "Could not start recording";
    $("tabHint").classList.add("error");
    $("startBtn").disabled = false;
    return;
  }
  $("title").value = "";
  renderRecorder();
};
$("stopBtn").onclick = async () => {
  await toBg({ type: "stop" });
  renderRecorder();
};
$("retryBtn").onclick = async () => {
  await toBg({ type: "retry-upload" });
  renderRecorder();
};
$("discardBtn").onclick = async () => {
  if (!confirm("Discard this recording? It can't be recovered (unless it's in Downloads).")) return;
  await toBg({ type: "discard" });
  renderRecorder();
};

// Recording finished uploading / failed while the popup is open
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "session" || !changes.rec || $("main").hidden) return;
  renderRecorder();
  if (changes.rec.newValue?.phase === "idle") loadList();
});

$("refreshBtn").onclick = () => loadList();

async function loadList() {
  const list = $("list");
  try {
    const rows = await api("/api/meetings");
    list.replaceChildren(
      ...(rows.length
        ? rows.slice(0, 30).map((m) =>
            el(
              "li",
              {},
              el(
                "button",
                { onclick: () => openMeeting(m.id) },
                el("div", { className: "t", textContent: m.title }),
                el("div", { className: "m" }, fmtDate(m.created_at), badge(m.status)),
              ),
            ),
          )
        : [el("li", { className: "empty", textContent: "No meetings yet" })]),
    );
  } catch (e) {
    if (e.status === 401) return openSettings("Please log in again");
    list.replaceChildren(
      el("li", {
        className: "empty error",
        textContent: e.message === "Failed to fetch" ? "Can't reach the server — is the app running?" : e.message,
      }),
    );
  }
}

function badge(status) {
  const label = { saved: "No summary", processing: "Summarizing", failed: "Failed" }[status];
  return label ? el("span", { className: `badge b-${status}`, textContent: label }) : null;
}

// ---------- Meeting detail ----------
$("backBtn").onclick = () => openMain();
$("backBtn").addEventListener("click", () => audioUrl && URL.revokeObjectURL(audioUrl));

async function openMeeting(id) {
  view("detail");
  $("dTitle").textContent = "Loading…";
  $("dDate").textContent = "";
  $("dBody").replaceChildren();
  try {
    renderMeeting(await api(`/api/meetings/${id}`));
  } catch (e) {
    $("dTitle").textContent = "Couldn't open meeting";
    $("dBody").replaceChildren(el("p", { className: "error", textContent: e.message }));
  }
}

let audioUrl = null;

// Player + save button for the copy kept on this computer, or a way to attach the file
function recordingSection(m, local) {
  if (m.audio_url) return null; // saved on the server (web app recording) — play it in the app
  if (audioUrl) URL.revokeObjectURL(audioUrl);
  if (local) {
    audioUrl = URL.createObjectURL(local.blob);
    return sec(
      "Recording (on this computer)",
      el("audio", { controls: true, src: audioUrl, style: "width:100%" }),
      el("button", {
        className: "link small",
        textContent: "Save file to Downloads",
        onclick: () => chrome.downloads.download({ url: audioUrl, filename: local.name }),
      }),
    );
  }
  const input = el("input", {
    type: "file",
    accept: "audio/*,video/*",
    onchange: async () => {
      const f = input.files[0];
      if (!f) return;
      await saveRecording({ key: crypto.randomUUID(), meetingId: m.id, title: m.title, name: f.name, blob: f, createdAt: Date.now() });
      renderMeeting(m);
    },
  });
  return sec(
    "Recording",
    el("p", { className: "hint", textContent: "Not on this computer. Pick the file (e.g. from Downloads) to create the summary." }),
    input,
  );
}

// Summary/transcript: server-saved audio → ask the server; local recording → background uploads it to Gemini first
async function requestSummary(m) {
  if (m.audio_url) return api(`/api/meetings/${m.id}`, { method: "POST" });
  const res = await toBg({ type: "summarize", meetingId: m.id });
  if (!res?.ok) throw new Error(res?.error || "Could not start the summary");
}

async function requestTranscript(m) {
  if (m.transcript) return m.transcript;
  if (m.audio_url) return (await api(`/api/meetings/${m.id}/transcript`, { method: "POST" })).transcript;
  const res = await toBg({ type: "transcript", meetingId: m.id });
  if (!res?.ok) throw new Error(res?.error || "Transcript failed");
  return res.transcript;
}

async function renderMeeting(m) {
  clearInterval(pollId);
  $("dTitle").textContent = m.title;
  $("dDate").textContent = fmtDate(m.created_at);
  const body = $("dBody");
  const local = m.audio_url ? null : await getRecordingFor(m.id).catch(() => null);
  const { jobs = {} } = await chrome.storage.session.get("jobs");
  const recording = recordingSection(m, local);
  const openInApp = el("button", {
    className: "btn ghost",
    textContent: "Open in app ↗",
    onclick: async () => chrome.tabs.create({ url: (await getSettings()).server }),
  });

  if (jobs[m.id] === "summary") {
    body.replaceChildren(
      el(
        "div",
        { className: "sec center-box" },
        el("div", { className: "row", style: "justify-content:center" }, el("span", { className: "spin" }), "Sending recording to Gemini…"),
        el("p", { className: "hint", textContent: "Goes straight from this computer. You can close this popup." }),
      ),
      recording,
    );
    pollId = setInterval(async () => {
      const { jobs = {} } = await chrome.storage.session.get("jobs");
      if (!jobs[m.id]) openMeeting(m.id);
    }, 2000);
    return;
  }

  if (m.status === "saved" || m.status === "failed") {
    const canSummarize = !!(m.audio_url || local);
    const btn = el("button", {
      className: "btn primary",
      disabled: !canSummarize,
      textContent: m.status === "failed" ? "Retry summary" : "✨ Create summary",
      onclick: async () => {
        btn.disabled = true;
        btn.textContent = m.audio_url ? "Starting…" : "Sending recording to Gemini…";
        try {
          await requestSummary(m);
          renderMeeting({ ...m, status: "processing" });
        } catch (e) {
          btn.disabled = false;
          btn.textContent = "Retry summary";
          body.append(el("p", { className: "error", textContent: e.message }));
        }
      },
    });
    body.replaceChildren(
      el(
        "div",
        { className: "sec center-box" },
        m.status === "failed"
          ? [
              el("p", { className: "error", textContent: `Summary failed: ${m.error || "unknown error"}` }),
              el("p", { className: "hint", textContent: "Your recording is saved, so nothing is lost." }),
            ]
          : [
              el("p", {}, el("b", { textContent: "Recording saved — no summary yet" })),
              el("p", { className: "hint", textContent: "The AI summary is only made when you ask for it." }),
            ],
        el("div", { className: "actions", style: "justify-content:center" }, btn, openInApp),
      ),
      recording,
    );
    return;
  }

  if (m.status === "processing") {
    body.replaceChildren(
      el(
        "div",
        { className: "sec center-box" },
        el("div", { className: "row", style: "justify-content:center" }, el("span", { className: "spin" }), "Creating summary…"),
        el("p", { className: "hint", textContent: "Takes 30 seconds to a few minutes. You can close this popup." }),
      ),
      recording,
    );
    pollId = setInterval(async () => {
      const fresh = await api(`/api/meetings/${m.id}`).catch(() => null);
      if (fresh && fresh.status !== "processing") renderMeeting(fresh);
    }, 5000);
    return;
  }

  // done
  const copyBtn = el("button", { className: "btn primary", textContent: "Copy summary", onclick: () => copy(m, copyBtn) });
  const transcriptBox = el("div");
  const transcriptBtn = el("button", {
    className: "link small",
    textContent: "Show full transcript",
    onclick: () => toggleTranscript(m, transcriptBtn, transcriptBox),
  });

  body.replaceChildren(
    el("div", { className: "actions" }, copyBtn, openInApp),
    sec("Overview", el("p", { textContent: m.overview || "" })),
    sec(
      `Action items (${m.action_items.length})`,
      m.action_items.length
        ? m.action_items.map((a) =>
            el("div", { className: "ai" }, el("b", { textContent: a.owner }), a.task, " ", el("span", { className: "due", textContent: `· ${a.due}` })),
          )
        : empty(),
    ),
    sec("Decisions", bullets(m.decisions)),
    sec("Open questions", bullets(m.questions)),
    sec("Transcript", transcriptBtn, transcriptBox),
    recording,
  );
}

const sec = (title, ...kids) => el("div", { className: "sec" }, el("h3", { textContent: title }), ...kids);
const empty = () => el("p", { className: "hint", textContent: "Nothing noted" });
const bullets = (items) => (items.length ? el("ul", {}, items.map((t) => el("li", { textContent: t }))) : empty());

async function toggleTranscript(m, btn, box) {
  if (box.childElementCount) {
    box.replaceChildren();
    btn.textContent = "Show full transcript";
    return;
  }
  btn.disabled = true;
  btn.textContent = m.transcript ? "Loading…" : "Writing transcript… (about a minute per hour)";
  try {
    m.transcript = await requestTranscript(m);
    box.replaceChildren(el("p", { textContent: m.transcript, style: "white-space:pre-wrap;max-height:260px;overflow:auto" }));
    btn.textContent = "Hide transcript";
  } catch (e) {
    btn.textContent = "Show full transcript";
    box.replaceChildren(el("p", { className: "error", textContent: e.message }));
  } finally {
    btn.disabled = false;
  }
}

function copy(m, btn) {
  const lines = [
    `*${m.title}* (${fmtDate(m.created_at)})`,
    "",
    m.overview ?? "",
    ...(m.decisions.length ? ["", "*Decisions*", ...m.decisions.map((d) => `• ${d}`)] : []),
    ...(m.action_items.length
      ? ["", "*Action items*", ...m.action_items.map((a) => `• ${a.owner}: ${a.task} (due: ${a.due})`)]
      : []),
    ...(m.questions.length ? ["", "*Open questions*", ...m.questions.map((q) => `• ${q}`)] : []),
  ];
  navigator.clipboard.writeText(lines.join("\n"));
  btn.textContent = "Copied ✓";
  setTimeout(() => (btn.textContent = "Copy summary"), 1500);
}

// ---------- Boot ----------
(async () => {
  const { token } = await getSettings();
  if (!token) return openSettings();
  const { rec } = await chrome.storage.session.get({ rec: {} });
  await openMain();
  // Just saved a recording → jump straight to it
  if (rec.lastMeetingId && rec.phase === "idle") {
    await chrome.storage.session.set({ rec: { phase: "idle" } });
    openMeeting(rec.lastMeetingId);
  }
})();
