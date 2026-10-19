import type { NextRequest } from "next/server";
import { AUTH_COOKIE, authToken } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const { password, wantToken } = await req.json().catch(() => ({ password: "" }));
  if (!process.env.TEAM_PASSWORD || password !== process.env.TEAM_PASSWORD) {
    return Response.json({ error: "Wrong password" }, { status: 401 });
  }
  // Only the extension asks for the token in the body; the web app relies on the HttpOnly cookie
  const res = Response.json(wantToken ? { ok: true, token: authToken() } : { ok: true });
  const secure = req.nextUrl.protocol === "https:" || req.headers.get("x-forwarded-proto") === "https";
  res.headers.append(
    "Set-Cookie",
    `${AUTH_COOKIE}=${authToken()}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}${secure ? "; Secure" : ""}`,
  );
  return res;
}

export async function DELETE() {
  const res = Response.json({ ok: true });
  res.headers.append("Set-Cookie", `${AUTH_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  return res;
}
