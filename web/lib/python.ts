import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

export type ProcessResult = {
  code: number | null;
  stdout: string;
  stderr: string;
  command: string;
  timedOut?: boolean;
};

export type PythonErrorCode = "python_not_found" | "python_missing_dependency" | "python_timeout" | "format_docx_failed";

export class PythonExecutionError extends Error {
  readonly errorCode: PythonErrorCode;
  constructor(result: ProcessResult) {
    super(extractPythonMessage(result));
    this.errorCode = classifyPythonFailure(result);
  }
}

export function getPythonCommand() {
  return process.env.PYTHON_CMD || getBundledPythonPath() || "python";
}

function getTimeoutMs() {
  const value = Number(process.env.PYTHON_TIMEOUT_MS);
  return Number.isSafeInteger(value) && value > 0 && value <= 2147483647 ? value : 120000;
}

export function classifyPythonFailure(result: ProcessResult): PythonErrorCode {
  if (result.timedOut) return "python_timeout";
  if (result.code === -1) return "python_not_found";
  const combined = `${result.stderr}\n${result.stdout}`;
  if (/No module named ['"]docx['"]/.test(combined) || /缺少[^\n]*python-docx/.test(combined)) {
    return "python_missing_dependency";
  }
  return "format_docx_failed";
}

export async function runPythonMergeRules(
  templateName: string,
  overridePath: string,
  finalRulesPath: string,
  debugRulesPath?: string,
) {
  const projectRoot = path.resolve(process.cwd(), "..");
  const scriptPath = path.join(projectRoot, "format_docx.py");

  const args = [
    scriptPath,
    "--template",
    templateName,
    "--override",
    overridePath,
    "--export-final-rules",
    finalRulesPath,
    "--merge-rules",
  ];

  if (debugRulesPath) {
    args.push("--export-debug-rules", debugRulesPath);
  }

  const result = await runPythonWithFallback(getPythonCommand(), args);

  if (result.code !== 0) {
    throw new PythonExecutionError(result);
  }

  return {
    stdout: result.stdout,
    stderr: result.stderr,
    warnings: extractPythonWarnings(result),
  };
}

export function runPython(command: string, args: string[], timeoutMs = getTimeoutMs()): Promise<ProcessResult> {
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
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      // The formatter runs in this process; force termination before resolving on close.
      child.kill("SIGKILL");
    }, timeoutMs);

    child.stdout.setEncoding("utf-8");
    child.stderr.setEncoding("utf-8");

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({
        code: -1,
        stdout,
        stderr: `无法启动 Python。请确认 PYTHON_CMD 或 python 命令可用。${error.message}`,
        command,
      });
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: timedOut ? -2 : code, stdout, stderr, command, timedOut });
    });
  });
}

export async function runPythonWithFallback(command: string, args: string[]) {
  const result = await runPython(command, args);
  if (!shouldRetryWithBundledPython(result)) {
    return result;
  }

  const bundledPython = getBundledPythonPath();
  if (!bundledPython || normalizeCommandPath(bundledPython) === normalizeCommandPath(command)) {
    return result;
  }

  return runPython(bundledPython, args);
}

export function extractPythonMessage(result: ProcessResult) {
  if (result.timedOut) return "Python 处理超时，任务已终止。请重试；较大文档可调整 PYTHON_TIMEOUT_MS 后重启服务。";
  const combined = `${result.stderr}\n${result.stdout}`.trim();
  const lines = combined
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const errorLine = lines.find((line) => line.startsWith("错误："));

  if (classifyPythonFailure(result) === "python_missing_dependency") {
    const baseMessage =
      errorLine || "错误：当前网页调用的 Python 环境缺少 python-docx。";
    return `${baseMessage} 请在项目根目录运行：python -m pip install -r requirements.txt，然后重启 npm run dev。`;
  }

  if (errorLine) {
    return errorLine;
  }

  return lines[0] || "Python 工具处理失败。";
}

function extractPythonWarnings(result: ProcessResult) {
  const combined = `${result.stderr}\n${result.stdout}`.trim();
  return combined
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("警告："))
    .map((line) => line.replace(/^警告：/, "").trim())
    .filter(Boolean);
}

function shouldRetryWithBundledPython(result: ProcessResult) {
  if (result.code === 0 || result.timedOut) return false;
  const errorCode = classifyPythonFailure(result);
  return errorCode === "python_not_found" || errorCode === "python_missing_dependency";
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
