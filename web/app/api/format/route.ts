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
  command: string;
};

type FormatErrorCode =
  | "missing_input_file"
  | "missing_template"
  | "invalid_template"
  | "invalid_docx"
  | "file_too_large"
  | "override_too_large"
  | "invalid_override_json"
  | "invalid_override_file"
  | "temp_job_create_failed"
  | "input_file_missing"
  | "format_script_missing"
  | "python_not_found"
  | "python_missing_dependency"
  | "format_docx_failed"
  | "output_docx_missing"
  | "report_missing"
  | "report_json_invalid"
  | "permission_denied"
  | "api_route_error"
  | "unknown_error";

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
      return fail("请先上传 Word 文件。", 400, "missing_input_file");
    }

    if (typeof templateValue !== "string" || !templateValue.trim()) {
      return fail("请选择默认排版方案。", 400, "missing_template");
    }

    const templateName = templateValue.trim();
    if (!SAFE_TEMPLATE_NAME.test(templateName)) {
      return fail("默认排版方案名称不合法。", 400, "invalid_template");
    }

    if (!fileValue.name.toLowerCase().endsWith(".docx")) {
      return fail("只能上传 .docx 格式的 Word 文件。", 400, "invalid_docx");
    }

    if (fileValue.size > MAX_FILE_SIZE) {
      return fail("Word 文件不能超过 10MB。", 400, "file_too_large");
    }

    const overrideText =
      typeof overrideTextValue === "string" ? overrideTextValue.trim() : "";
    let parsedOverrideText: unknown = null;
    let hasOverride = false;

    if (overrideText) {
      if (Buffer.byteLength(overrideText, "utf-8") > MAX_OVERRIDE_TEXT_SIZE) {
        return fail("识别出的格式规则太长，请精简格式要求后再试。", 400, "override_too_large");
      }

      try {
        parsedOverrideText = JSON.parse(overrideText);
      } catch {
        return fail(
          "识别出的格式规则不是有效 JSON，请重新解析格式要求。",
          400,
          "invalid_override_json",
        );
      }

      if (
        typeof parsedOverrideText !== "object" ||
        parsedOverrideText === null ||
        Array.isArray(parsedOverrideText)
      ) {
        return fail(
          "识别出的格式规则格式不正确，请重新解析格式要求。",
          400,
          "invalid_override_json",
        );
      }

      hasOverride = true;
      if (overrideValue instanceof File && overrideValue.size > 0) {
        notices.push("已优先使用文本框中的自定义规则，忽略上传的 JSON 文件。");
      }
    } else if (overrideValue instanceof File && overrideValue.size > 0) {
      hasOverride = true;
      if (!overrideValue.name.toLowerCase().endsWith(".json")) {
        return fail("上传的规则文件必须是 .json 文件。", 400, "invalid_override_file");
      }
      if (overrideValue.size > MAX_OVERRIDE_SIZE) {
        return fail("上传的规则文件不能超过 1MB。", 400, "override_too_large");
      }
    }

    const jobId = crypto.randomUUID();
    const jobDir = path.join(process.cwd(), "tmp", "jobs", jobId);
    const inputPath = path.join(jobDir, "input.docx");
    const outputPath = path.join(jobDir, "output.docx");
    const reportPath = path.join(jobDir, "report.json");
    const overridePath = path.join(jobDir, "override.json");

    try {
      await fs.mkdir(jobDir, { recursive: true });
    } catch (error) {
      console.error("创建临时处理目录失败", error);
      return fail("创建临时处理目录失败，请检查文件权限。", 500, "temp_job_create_failed");
    }

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
    const pythonCmd = process.env.PYTHON_CMD || getBundledPythonPath() || "python";

    if (!existsSync(inputPath)) {
      return fail("上传后的 Word 文件没有保存成功，请重新上传。", 500, "input_file_missing");
    }

    if (!existsSync(scriptPath)) {
      return fail("本地 Word 修改脚本不存在，请检查项目文件是否完整。", 500, "format_script_missing");
    }

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
      const errorCode = classifyPythonFailure(result);
      console.error("format_docx.py 执行失败", {
        errorCode,
        code: result.code,
        command: maskUserPath(result.command),
        stderr: result.stderr.slice(0, 2000),
      });
      return fail(extractPythonMessage(result), 500, errorCode);
    }

    if (!existsSync(outputPath)) {
      return fail("Word 修改完成后没有生成输出文件。", 500, "output_docx_missing");
    }

    if (!existsSync(reportPath)) {
      return fail("Word 修改完成后没有生成处理报告。", 500, "report_missing");
    }

    let report: ReportFile;
    try {
      const reportRaw = await fs.readFile(reportPath, "utf-8");
      report = JSON.parse(reportRaw) as ReportFile;
    } catch (error) {
      console.error("读取处理报告失败", error);
      return fail("处理报告读取失败，请重新修改 Word。", 500, "report_json_invalid");
    }

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
    return fail(
      getUnknownErrorMessage(error),
      500,
      getUnknownErrorCode(error),
    );
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
        command,
      });
    });

    child.on("close", (code) => {
      resolve({ code, stdout, stderr, command });
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

function classifyPythonFailure(result: ProcessResult): FormatErrorCode {
  const combined = `${result.stderr}\n${result.stdout}`;
  if (result.code === -1) {
    return "python_not_found";
  }
  if (
    combined.includes("python-docx") ||
    combined.includes("No module named 'docx'") ||
    combined.includes('No module named "docx"')
  ) {
    return "python_missing_dependency";
  }
  return "format_docx_failed";
}

function fail(message: string, status: number, errorCode: FormatErrorCode = "unknown_error") {
  return NextResponse.json({ success: false, message, errorCode }, { status });
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

function getUnknownErrorCode(error: unknown): FormatErrorCode {
  if (isNodeError(error) && error.code === "EACCES") {
    return "permission_denied";
  }
  if (isNodeError(error) && error.code === "ENOENT") {
    return "input_file_missing";
  }
  return "api_route_error";
}

function getUnknownErrorMessage(error: unknown) {
  if (isNodeError(error) && error.code === "EACCES") {
    return "本地文件权限不足，请关闭正在占用的 Word 文件后重试。";
  }
  if (isNodeError(error) && error.code === "ENOENT") {
    return "处理所需的临时文件不存在，请重新上传 Word 后再试。";
  }
  return "修改失败，后端处理时遇到未知问题。";
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function maskUserPath(value: string) {
  const homeDir = process.env.USERPROFILE || process.env.HOME || "";
  if (!homeDir) {
    return value;
  }
  return value.replaceAll(homeDir, "<USER_HOME>");
}
