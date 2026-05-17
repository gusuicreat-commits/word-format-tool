import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";

import {
  callKimiForRequirements,
  detectSuspiciousInferredFields,
  mockParseRequirements,
  tryParseRequirementsLocally,
} from "../../../lib/kimi";
import { runPythonMergeRules } from "../../../lib/python";
import {
  collectOverrideFields,
  getFinalRulesPreview,
  summarizeOverrideRules,
} from "../../../lib/requirements";

export const runtime = "nodejs";

const MAX_REQUIREMENTS_LENGTH = 5000;
const SAFE_TEMPLATE_NAME = /^[A-Za-z0-9_-]+$/;
const PARSE_CACHE_LIMIT = 50;
const parseCache = new Map<string, Record<string, unknown>>();

type ParseRequest = {
  requirementsText?: unknown;
  template?: unknown;
};

export async function POST(request: Request) {
  try {
    let body: ParseRequest;
    try {
      body = (await request.json()) as ParseRequest;
    } catch {
      return fail("请求内容必须是 JSON。", 400);
    }

    const requirementsText =
      typeof body.requirementsText === "string" ? body.requirementsText.trim() : "";
    const templateName =
      typeof body.template === "string" && body.template.trim()
        ? body.template.trim()
        : "default";

    if (!requirementsText) {
      return fail("请先粘贴老师的格式要求。", 400);
    }

    if (requirementsText.length > MAX_REQUIREMENTS_LENGTH) {
      return fail("格式要求内容过长，请控制在 5000 字以内。", 400);
    }

    if (!SAFE_TEMPLATE_NAME.test(templateName)) {
      return fail("模板名称不合法。", 400);
    }

    const cacheKey = makeCacheKey(templateName, requirementsText);
    const cachedResult = parseCache.get(cacheKey);
    if (cachedResult) {
      return NextResponse.json({ ...cachedResult, cached: true });
    }

    const mockEnabled = process.env.ENABLE_KIMI_MOCK === "true";
    let mode: "local" | "mock" | "kimi" = mockEnabled ? "mock" : "kimi";

    let rawModelOutput = "";
    let parsedOverride;
    if (mockEnabled) {
      parsedOverride = mockParseRequirements(requirementsText);
      rawModelOutput = JSON.stringify(parsedOverride, null, 2);
    } else {
      const localOverride = tryParseRequirementsLocally(requirementsText);
      if (localOverride) {
        parsedOverride = localOverride;
        rawModelOutput = JSON.stringify(localOverride, null, 2);
        mode = "local";
      } else {
        if (!process.env.KIMI_API_KEY) {
          return fail("错误：未配置 KIMI_API_KEY，请在 web/.env.local 中配置 Kimi API Key。", 400);
        }
        if (!process.env.KIMI_MODEL) {
          return fail("错误：未配置 KIMI_MODEL，请在 web/.env.local 中设置模型名。", 400);
        }

        try {
          const kimiResult = await callKimiForRequirements(requirementsText);
          rawModelOutput = kimiResult.rawModelOutput;
          parsedOverride = kimiResult.parsedOverride;
        } catch (error) {
          return fail(`格式要求解析失败：${getErrorMessage(error)}`, 500);
        }
      }
    }

    const jobId = crypto.randomUUID();
    const jobDir = path.join(process.cwd(), "tmp", "parse-jobs", jobId);
    const overridePath = path.join(jobDir, "override.json");
    const finalRulesPath = path.join(jobDir, "final_rules.json");
    const debugRulesPath = path.join(jobDir, "debug_rules.json");

    await fs.mkdir(jobDir, { recursive: true });
    await fs.writeFile(overridePath, JSON.stringify(parsedOverride, null, 2), "utf-8");

    let mergeWarnings: string[] = [];
    try {
      const mergeResult = await runPythonMergeRules(
        templateName,
        overridePath,
        finalRulesPath,
        debugRulesPath,
      );
      mergeWarnings = mergeResult.warnings;
    } catch (error) {
      return fail(
        `格式要求解析失败：AI 解析出的格式规则未通过校验：${getErrorMessage(error)}`,
        400,
      );
    }

    const finalRulesRaw = await fs.readFile(finalRulesPath, "utf-8");
    const finalRules = JSON.parse(finalRulesRaw) as unknown;
    const debugRulesRaw = await fs.readFile(debugRulesPath, "utf-8");
    const debugRules = JSON.parse(debugRulesRaw) as Record<string, unknown>;
    const normalizedOverride = debugRules.normalized_override ?? parsedOverride;
    const finalRulesDebug = debugRules.final_rules ?? finalRules;
    const debugSummary = debugRules.debug_summary ?? {};
    const summary = summarizeOverrideRules(normalizedOverride);
    const suspiciousWarnings = detectSuspiciousInferredFields(
      requirementsText,
      normalizedOverride,
    );
    const warnings = Array.from(
      new Set([...summary.warnings, ...suspiciousWarnings, ...mergeWarnings]),
    );

    const payload = {
      success: true,
      message: "格式要求解析成功",
      jobId,
      mode,
      rawModelOutput,
      parsedOverride,
      normalizedOverride,
      finalRules: finalRulesDebug,
      debugSummary,
      override: normalizedOverride,
      overriddenFields: collectOverrideFields(normalizedOverride),
      warnings,
      summary: summary.items,
      finalRulesPreview: getFinalRulesPreview(finalRulesDebug),
      cached: false,
    };

    rememberParseResult(cacheKey, payload);
    return NextResponse.json(payload);
  } catch (error) {
    return fail(`格式要求解析失败：${getErrorMessage(error)}`, 500);
  }
}

function fail(message: string, status: number) {
  return NextResponse.json({ success: false, message }, { status });
}

function getErrorMessage(error: unknown) {
  if (!(error instanceof Error)) {
    return "未知错误";
  }

  const lowerMessage = error.message.toLowerCase();
  if (
    lowerMessage.includes("request timed out") ||
    lowerMessage.includes("timed out") ||
    lowerMessage.includes("timeout")
  ) {
    return "错误：Kimi API 请求超时，请检查网络、模型名或稍后重试。";
  }

  return error.message;
}

function makeCacheKey(templateName: string, requirementsText: string) {
  return `${templateName}::${requirementsText.replace(/\s+/g, " ").trim()}`;
}

function rememberParseResult(key: string, value: Record<string, unknown>) {
  if (parseCache.size >= PARSE_CACHE_LIMIT) {
    const oldestKey = parseCache.keys().next().value;
    if (oldestKey) {
      parseCache.delete(oldestKey);
    }
  }

  parseCache.set(key, value);
}
