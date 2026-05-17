import { promises as fs } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const SAFE_JOB_ID = /^[A-Za-z0-9_-]+$/;

export async function GET(
  _request: Request,
  context: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await context.params;

  if (!SAFE_JOB_ID.test(jobId)) {
    return NextResponse.json(
      { success: false, message: "下载任务编号不合法。" },
      { status: 400 },
    );
  }

  const outputPath = path.join(process.cwd(), "tmp", "jobs", jobId, "output.docx");

  try {
    const file = await fs.readFile(outputPath);
    return new Response(new Uint8Array(file), {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": 'attachment; filename="formatted-paper.docx"',
      },
    });
  } catch {
    return NextResponse.json(
      { success: false, message: "未找到可下载的处理结果。" },
      { status: 404 },
    );
  }
}
