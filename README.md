# Meeting Notes

AI meeting summaries for the team. Record a Google Meet tab (or upload a recording) → Gemini writes the overview, decisions, action items, open questions and transcript → saved in Supabase.

Stack: Next.js (App Router) · Tailwind · Gemini API · Supabase (Postgres)

## Run locally

1. Put your Gemini key in `.env.local` → `GEMINI_API_KEY=...`
2. `npm install` (first time only)
3. `npm run dev` → open http://localhost:3000
4. Log in with `TEAM_PASSWORD` from `.env.local`

## How to record a Meet call

1. Join the Meet in a Chrome/Edge tab.
2. In this app click **Start recording** → pick the **Meet tab** → keep **"Also share tab audio"** on → Share.
3. Allow the microphone (so your own voice is included).
4. After the meeting click **Stop & summarize**.

## Deploy on Hostinger (Node.js hosting)

Needs a plan with Node.js apps (Business / Cloud web hosting, or a VPS).

1. hPanel → Websites → **Add website** → **Node.js app**, then upload this folder as a zip (skip `node_modules` and `.next`) or connect a GitHub repo.
2. Framework: **Next.js** · Build: `npm run build` · Start: `npm start` · Node 20+.
3. Add the environment variables from `.env.local` in the app's settings:
   `GEMINI_API_KEY`, `GEMINI_MODEL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `TEAM_PASSWORD`, `AUTH_SECRET`.
4. Deploy, then share the link + team password with your team.

Tip: in Chrome, menu → **Cast, save and share → Install page as app** gives a desktop icon.

## Database

The `meetings` table is defined in `schema.sql`. Recordings are saved in a private Supabase Storage bucket `recordings` (created automatically) so you can play them back and retry a failed summary. Deleting a meeting also deletes its recording.

### Backup copies of recordings

Every recording is kept in up to three places, so one failure never loses it:

1. **Server disk** – `recordings/` in the app folder (change with `RECORDINGS_DIR`). Written first; summaries and playback use it when present.
2. **Supabase Storage** – bucket `recordings`. Used if the disk copy is missing.
3. **Your computer** – live recordings are also downloaded to your Downloads folder (checkbox under *Start recording*).

If Supabase fails or hits its limit, the app still saves and summarizes from the server copy. If the database itself is down, the error message tells you where the server copy is. Upload that file (or the one in your Downloads) later with **Upload a recording**.
