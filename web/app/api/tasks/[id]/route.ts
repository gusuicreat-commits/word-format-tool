import { NextResponse } from "next/server";
import { owner, sameOrigin } from "../../../../lib/session";
import { getTask, publicTask, confirmTask, retryTask, deleteTask, editTask } from "../../../../lib/tasks";

type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  try { return NextResponse.json({ task: publicTask(await getTask(request, (await context.params).id)) }, { headers: { "Cache-Control": "no-store" } }); }
  catch { return NextResponse.json({ message: "任务不存在或已过期。" }, { status: 404 }); }
}
export async function POST(request: Request, context: Context) {
  if (!owner(request) || !sameOrigin(request)) return NextResponse.json({ message: "无法执行操作。" }, { status: 403 });
  try {
    const text = await request.text(); if (text.length > 2 * 1024 * 1024) throw new Error("确认数据过大。");
    const body = JSON.parse(text); const id = (await context.params).id;
    const task = body.action === "edit" ? await editTask(request, id, body.requirements) : body.action === "retry" ? await retryTask(request, id) : await confirmTask(request, id, body.review);
    return NextResponse.json({ task: publicTask(task) }, { status: 202 });
  } catch { return NextResponse.json({ message: "任务不可操作，请刷新后重试。" }, { status: 400 }); }
}
export async function DELETE(request: Request, context: Context) {
  if (!owner(request) || !sameOrigin(request)) return NextResponse.json({ message: "无法执行操作。" }, { status: 403 });
  try { await deleteTask(request, (await context.params).id); return NextResponse.json({ success: true }); }
  catch { return NextResponse.json({ message: "任务不存在、已过期或正在处理。" }, { status: 409 }); }
}
