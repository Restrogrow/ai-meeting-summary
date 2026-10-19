import "server-only";
import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";

export const AUTH_COOKIE = "ms_auth";

export function authToken() {
  return createHash("sha256")
    .update(`${process.env.TEAM_PASSWORD}:${process.env.AUTH_SECRET}`)
    .digest("hex");
}

// Web app sends the cookie; the Chrome extension sends the same token as a header
export function isAuthed(req: NextRequest) {
  const token = req.cookies.get(AUTH_COOKIE)?.value ?? req.headers.get("x-team-token");
  return token === authToken();
}

export const unauthorized = () => Response.json({ error: "Not logged in" }, { status: 401 });
