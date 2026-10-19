// Shared by popup, background and offscreen: settings + calls to the Meeting Notes server
const DEFAULT_SERVER = "http://localhost:3000";

async function getSettings() {
  const s = await chrome.storage.local.get({ server: DEFAULT_SERVER, token: "", keepCopy: true, useMic: true });
  s.server = s.server.replace(/\/+$/, "");
  return s;
}

async function api(path, init = {}) {
  const { server, token } = await getSettings();
  const res = await fetch(server + path, {
    ...init,
    headers: { ...(init.headers || {}), ...(token ? { "x-team-token": token } : {}) },
  });
  const data = await res.json().catch(() => ({ error: `Server error (${res.status})` }));
  if (!res.ok) {
    const err = new Error(data.error || `Server error (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}
