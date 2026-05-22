import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MAX_OVERRIDE_SIZE = 1 * 1024 * 1024;
const MAX_OVERRIDE_TEXT_SIZE = 50 * 1024;
const SAFE_TEMPLATE_NAME = /^[A-Za-z0-9_-]+$/;

type ProcessResult = {
  code: number | null;
  stdout: string;
  stderr: string;
};

type ReportFile = {
  template?: {
    name?: string;
    description?: string;
  };
  base_template?: {
    name?: string;
    description?: string;
    path?: string;
  };
  override?: {
    enabled?: boolean;
    path?: string;
    name?: string;
    description?: string;
    overridden_fields?: string[];
    warnings?: string[];
    warning_count?: number;
  };
  final_rules?: {
    name?: string;
    description?: string;
  };
  stats?: Record<string, number>;
  module_status?: Record<
    string,
    {
      status?: string;
      count?: number;
      action?: string;
      note?: string;
    }
  >;
  warnings?: Array<{
    paragraph_index: number | null;
    text_preview: string;
    message: string;
  }>;
};

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const fileValue = formData.get("file");
    const templateValue = formData.get("template");
    const overrideTextValue = formData.get("overrideText");
    const overrideValue = formData.get("override");
    const notices: string[] = [];

    if (!(fileValue instanceof File)) {
      return fail("请上传 .docx 文件。", 400);
    }

    if (typeof templateValue !== "string" || !templateValue.trim()) {
      return fail("请选择模板。", 400);
    }

    const templateName = templateValue.trim();
    if (!SAFE_TEMPLATE_NAME.test(templateName)) {
      return fail("模板名称不合法。", 400);
    }

    if (!fileValue.name.toLowerCase().endsWith(".docx")) {
      return fail("错误：输入文件必须是 .docx 格式。", 400);
    }

    if (fileValue.size > MAX_FILE_SIZE) {
      return fail("Word 文件不能超过 10MB。", 400);
    }

    const overrideText =
      typeof overrideTextValue === "string" ? overrideTextValue.trim() : "";
    let parsedOverrideText: unknown = null;
    let hasOverride = false;

    if (overrideText) {
      if (Buffer.byteLength(overrideText, "utf-8") > MAX_OVERRIDE_TEXT_SIZE) {
        return fail("自定义格式要求内容过长，请精简后再试。", 400);
      }

      try {
        parsedOverrideText = JSON.parse(overrideText);
      } catch {
        return fail(
          "自定义格式要求不是合法 JSON。当前版本暂不支持自然语言，请粘贴 JSON 覆盖规则。",
          400,
        );
      }

      if (
        typeof parsedOverrideText !== "object" ||
        parsedOverrideText === null ||
        Array.isArray(parsedOverrideText)
      ) {
        return fail(
          "自定义格式要求必须是 JSON 对象。当前版本暂不支持自然语言，请粘贴 JSON 覆盖规则。",
          400,
        );
      }

      hasOverride = true;
      if (overrideValue instanceof File && overrideValue.size > 0) {
        notices.push("已优先使用文本框中的自定义规则，忽略上传的 JSON 文件。");
      }
    } else if (overrideValue instanceof File && overrideValue.size > 0) {
      hasOverride = true;
      if (!overrideValue.name.toLowerCase().endsWith(".json")) {
        return fail("自定义覆盖规则必须是 .json 文件。", 400);
      }
      if (overrideValue.size > MAX_OVERRIDE_SIZE) {
        return fail("自定义覆盖规则 JSON 不能超过 1MB。", 400);
      }
    }

    const jobId = crypto.randomUUID();
    const jobDir = path.join(process.cwd(), "tmp", "jobs", jobId);
    const inputPath = path.join(jobDir, "input.docx");
    const outputPath = path.join(jobDir, "output.docx");
    const reportPath = path.join(jobDir, "report.json");
    const overridePath = path.join(jobDir, "override.json");

    await fs.mkdir(jobDir, { recursive: true });

    const buffer = Buffer.from(await fileValue.arrayBuffer());
    await fs.writeFile(inputPath, buffer);

    if (overrideText) {
      await fs.writeFile(
        overridePath,
        JSON.stringify(parsedOverrideText, null, 2),
        "utf-8",
      );
    } else if (hasOverride && overrideValue instanceof File) {
      const overrideBuffer = Buffer.from(await overrideValue.arrayBuffer());
      await fs.writeFile(overridePath, overrideBuffer);
    }

    const projectRoot = path.resolve(process.cwd(), "..");
    const scriptPath = path.join(projectRoot, "format_docx.py");
    const pythonCmd = process.env.PYTHON_CMD || "python";

    const pythonArgs = [
      scriptPath,
      inputPath,
      outputPath,
      "--template",
      templateName,
      "--report",
      reportPath,
      "--overwrite",
    ];

    if (hasOverride) {
      pythonArgs.push("--override", overridePath);
    }

    const result = await runPythonWithFallback(pythonCmd, pythonArgs);

    if (result.code !== 0) {
      return fail(extractPythonMessage(result), 500);
    }

    const reportRaw = await fs.readFile(reportPath, "utf-8");
    const report = JSON.parse(reportRaw) as ReportFile;

    return NextResponse.json({
      success: true,
      jobId,
      message: "处理成功",
      downloadUrl: `/api/download/${jobId}`,
      notices,
      report: {
        template: {
          name: report.template?.name || templateName,
          description: report.template?.description || "",
        },
        stats: report.stats || {},
        moduleStatus: report.module_status || {},
        warnings: report.warnings || [],
        baseTemplate: report.base_template || null,
        override: report.override || { enabled: false },
        finalRules: report.final_rules || null,
      },
    });
  } catch (error) {
    console.error("处理上传文件失败", error);
    return fail("处理失败，请确认本地 Python 环境和文件权限正常。", 500);
  }
}

function runPython(command: string, args: string[]): Promise<ProcessResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: path.resolve(process.cwd(), ".."),
      shell: false,
      windowsHide: true,
      env: {
        ...process.env,
        PYTHONIOENCODING: "utf-8",
        PYTHONUTF8: "1",
      },
    });

    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf-8");
    child.stderr.setEncoding("utf-8");

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    child.on("error", (error) => {
      resolve({
        code: -1,
        stdout,
        stderr: `无法启动 Python。请确认 PYTHON_CMD 或 python 命令可用。${error.message}`,
      });
    });

    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

async function runPythonWithFallback(command: string, args: string[]) {
  const result = await runPython(command, args);
  if (!shouldRetryWithBundledPython(command, result)) {
    return result;
  }

  const bundledPython = getBundledPythonPath();
  if (!bundledPython || normalizeCommandPath(bundledPython) === normalizeCommandPath(command)) {
    return result;
  }

  return runPython(bundledPython, args);
}

function extractPythonMessage(result: ProcessResult) {
  const combined = `${result.stderr}\n${result.stdout}`.trim();
  const lines = combined
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const errorLine = lines.find((line) => line.startsWith("错误："));

  if (
    combined.includes("python-docx") ||
    combined.includes("No module named 'docx'") ||
    combined.includes('No module named "docx"')
  ) {
    const baseMessage =
      errorLine || "错误：当前网页调用的 Python 环境缺少 python-docx。";
    return `${baseMessage} 请在项目根目录运行：python -m pip install -r requirements.txt，然后重启 npm run dev。`;
  }

  if (errorLine) {
    return errorLine;
  }

  return lines[0] || "Python 工具处理失败。";
}

function fail(message: string, status: number) {
  return NextResponse.json({ success: false, message }, { status });
}

function shouldRetryWithBundledPython(command: string, result: ProcessResult) {
  if (normalizeCommandPath(command).includes("codex-primary-runtime")) {
    return false;
  }

  const combined = `${result.stderr}\n${result.stdout}`;
  return (
    result.code === -1 ||
    combined.includes("python-docx") ||
    combined.includes("No module named 'docx'") ||
    combined.includes('No module named "docx"')
  );
}

function getBundledPythonPath() {
  const homeDir = process.env.USERPROFILE || process.env.HOME;
  if (!homeDir) {
    return "";
  }

  const pythonPath = path.join(
    homeDir,
    ".cache",
    "codex-runtimes",
    "codex-primary-runtime",
    "dependencies",
    "python",
    process.platform === "win32" ? "python.exe" : "bin/python",
  );

  return existsSync(pythonPath) ? pythonPath : "";
}

function normalizeCommandPath(command: string) {
  return command.replaceAll("\\", "/").toLowerCase();
}
