import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

export type ProcessResult = {
  code: number | null;
  stdout: string;
  stderr: string;
};

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

  const result = await runPythonWithFallback(process.env.PYTHON_CMD || "python", args);

  if (result.code !== 0) {
    throw new Error(extractPythonMessage(result));
  }

  return {
    stdout: result.stdout,
    stderr: result.stderr,
    warnings: extractPythonWarnings(result),
  };
}

export function runPython(command: string, args: string[]): Promise<ProcessResult> {
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

export async function runPythonWithFallback(command: string, args: string[]) {
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

export function extractPythonMessage(result: ProcessResult) {
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

function extractPythonWarnings(result: ProcessResult) {
  const combined = `${result.stderr}\n${result.stdout}`.trim();
  return combined
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("警告："))
    .map((line) => line.replace(/^警告：/, "").trim())
    .filter(Boolean);
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
