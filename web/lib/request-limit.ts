import { owner, sameOrigin } from "./session";
const globals = globalThis as typeof globalThis & { wordLimit?: { active: number; buckets: Map<string, { count: number; until: number }> } };
const state = globals.wordLimit ||= { active: 0, buckets: new Map() };
export async function limited(request: Request, execute: () => Promise<Response>) {
  const id = owner(request);
  if (!id || !sameOrigin(request)) return Response.json({ message: "请刷新页面。" }, { status: 403 });
  if (Number(request.headers.get("content-length")) > 12 * 1024 * 1024) return Response.json({ message: "请求过大。" }, { status: 413 });
  for (const [key, value] of state.buckets) if (value.until < Date.now()) state.buckets.delete(key);
  const bucket = state.buckets.get(id) || { count: 0, until: Date.now() + 60000 };
  if (bucket.count >= 12 || state.active >= 2) return Response.json({ message: "请求较多，请稍后重试。" }, { status: 429 });
  bucket.count++; state.buckets.set(id, bucket); state.active++;
  try { return await execute(); } finally { state.active--; }
}
