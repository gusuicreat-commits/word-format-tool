import { NextResponse } from "next/server";
import { owner, sameOrigin } from "../../../lib/session";
import { createTask, currentTask, publicTask } from "../../../lib/tasks";

export const runtime = "nodejs";
export async function GET(request: Request) {
  if (!owner(request)) return NextResponse.json({ message: "请刷新页面。" }, { status: 403 });
  const task = await currentTask(request);
  return NextResponse.json({ task: task ? publicTask(task) : null }, { headers: { "Cache-Control": "no-store" } });
}
export async function POST(request: Request) {
  if (!owner(request) || !sameOrigin(request)) return NextResponse.json({ message: "请刷新页面。" }, { status: 403 });
  if (Number(request.headers.get("content-length")) > 11 * 1024 * 1024) return NextResponse.json({ message: "文件不能超过 10MB。" }, { status: 413 });
  try {
    const form = await request.formData(); const file = form.get("file"); const requirements = String(form.get("requirements") || "");
    if (!(file instanceof File) || !file.name.toLowerCase().endsWith(".docx") || file.size > 10 * 1024 * 1024 || requirements.length > 5000) throw new Error("请选择 10MB 以内的 DOCX，格式要求不超过 5000 字。");
    return NextResponse.json({ task: publicTask(await createTask(request, file, requirements)) }, { status: 202 });
  } catch (error) { return NextResponse.json({ message: error instanceof Error ? error.message : "上传失败。" }, { status: 400 }); }
}
