// Recordings are kept on this computer (extension IndexedDB), never on the server.
// Record: { key, meetingId, title, name, blob, createdAt }
function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("meeting-notes", 1);
    req.onupgradeneeded = () => {
      const store = req.result.createObjectStore("recordings", { keyPath: "key" });
      store.createIndex("meetingId", "meetingId");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbRun(mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("recordings", mode);
    const req = fn(tx.objectStore("recordings"));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
  });
}

const saveRecording = (rec) => dbRun("readwrite", (s) => s.put(rec));
const getRecording = (key) => dbRun("readonly", (s) => s.get(key));
const getRecordingFor = (meetingId) => dbRun("readonly", (s) => s.index("meetingId").get(meetingId));
const deleteRecording = (key) => dbRun("readwrite", (s) => s.delete(key));
