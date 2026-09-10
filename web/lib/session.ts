import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

export const dataRoot = () => path.resolve(process.cwd(), "tmp");
export const cookieName = "word_session";
export function sessionToken(request: Request) {
  const token = request.headers.get("cookie")?.split(";").map(s => s.trim()).find(s => s.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
  return token && /^[a-f0-9]{64}$/.test(token) ? token : null;
}
export function owner(request: Request) {
  const token = sessionToken(request);
  return token ? crypto.createHash("sha256").update(token).digest("hex") : null;
}
export function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try { return process.env.PUBLIC_ORIGIN ? origin === process.env.PUBLIC_ORIGIN : new URL(origin).host === (request.headers.get("host") || new URL(request.url).host); }
  catch { return false; }
}
export const ttl = 2 * 60 * 60 * 1000;
export async function ownOutput(request: Request, id: string) {
  if (!/^[a-f0-9-]{36}$/.test(id) || !owner(request)) return false;
  try {
    const meta = JSON.parse(await fs.readFile(path.join(dataRoot(), "jobs", id, "access.json"), "utf8"));
    return meta.owner === owner(request) && meta.expiresAt > Date.now();
  } catch { return false; }
}
