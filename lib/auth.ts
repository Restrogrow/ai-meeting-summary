import "server-only";
import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";

export const AUTH_COOKIE = "ms_auth";

export function authToken() {
  return createHash("sha256")
    .update(`${process.env.TEAM_PASSWORD}:${process.env.AUTH_SECRET}`)
    .digest("hex");
}

export function isAuthed(req: NextRequest) {
  return req.cookies.get(AUTH_COOKIE)?.value === authToken();
}

export const unauthorized = () => Response.json({ error: "Not logged in" }, { status: 401 });
