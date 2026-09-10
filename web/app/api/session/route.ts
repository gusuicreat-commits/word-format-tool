import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { cookieName, sessionToken } from "../../../lib/session";

export async function GET(request: Request) {
  const response = NextResponse.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
  if (!sessionToken(request)) response.cookies.set(cookieName, crypto.randomBytes(32).toString("hex"), {
    httpOnly: true, sameSite: "strict", secure: (process.env.PUBLIC_ORIGIN || new URL(request.url).origin).startsWith("https:"), path: "/", maxAge: 86400,
  });
  return response;
}
