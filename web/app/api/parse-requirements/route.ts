import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";

import {
  analyzeRequirementComplexity,
  callKimiForCanonicalRequirements,
  detectStructuredRuleConflicts,
  detectSuspiciousInferredFields,
  getKimiRuntimeConfig,
  KimiApiError,
  mockCanonicalRequirementsText,
  normalizeAiParsedRules,
  parseCanonicalRequirementsText,
  tryParseRequirementsLocally,
  validateOverrideAgainstSchema,
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
  forceMode?: unknown;
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
    const forceMode = body.forceMode === "local" ? "local" : "auto";

    if (!requirementsText) {
      return fail("请先粘贴老师的格式要求。", 400);
    }

    if (requirementsText.length > MAX_REQUIREMENTS_LENGTH) {
      return fail("格式要求内容过长，请控制在 5000 字以内。", 400);
    }

    if (!SAFE_TEMPLATE_NAME.test(templateName)) {
      return fail("模板名称不合法。", 400);
    }

    const cacheKey = makeCacheKey(templateName, requirementsText, forceMode);
    const cachedResult = parseCache.get(cacheKey);
    if (cachedResult) {
      return NextResponse.json({ ...cachedResult, cached: true });
    }

    const complexity = analyzeRequirementComplexity(requirementsText);
    const mockEnabled = process.env.ENABLE_KIMI_MOCK === "true";
    let mode: "local" | "mock_canonical" | "kimi_canonical" = mockEnabled
      ? "mock_canonical"
      : "kimi_canonical";

    let rawModelOutput = "";
    let parsedOverride;
    let canonicalRequirementsText = "";
    let canonicalWarnings: string[] = [];
    let canonicalDroppedLines: string[] = [];
    if (mockEnabled) {
      canonicalRequirementsText = mockCanonicalRequirementsText(requirementsText);
      rawModelOutput = canonicalRequirementsText;
      const canonicalParse = parseCanonicalRequirementsText(canonicalRequirementsText, {
        requirementsText,
      });
      canonicalRequirementsText = canonicalParse.canonicalRequirementsText;
      parsedOverride = canonicalParse.rules;
      canonicalWarnings = canonicalParse.warnings;
      canonicalDroppedLines = canonicalParse.droppedLines;
    } else {
      const localOverride =
        forceMode === "local"
          ? tryParseRequirementsLocally(requirementsText, { allowComplex: true })
          : complexity.shouldUseKimi
            ? null
            : tryParseRequirementsLocally(requirementsText);
      if (localOverride) {
        parsedOverride = localOverride;
        rawModelOutput = JSON.stringify(localOverride, null, 2);
        mode = "local";
      } else if (forceMode === "local") {
        return fail(
          "本地快速解析无法识别这段格式要求，请编辑要求后重试 Kimi。",
          400,
          "local_parse_unavailable",
          {
            recoveryActions: getRecoveryActions("local_parse_unavailable"),
          },
        );
      } else {
        if (!process.env.KIMI_API_KEY) {
          return fail(
            "错误：未配置 KIMI_API_KEY，请在 web/.env.local 中配置 Kimi API Key。",
            400,
            "missing_api_key",
            {
              recoveryActions: getRecoveryActions("missing_api_key"),
              kimiConfig: getSafeKimiConfig(),
            },
          );
        }
        if (!process.env.KIMI_MODEL) {
          return fail(
            "错误：未配置 KIMI_MODEL，请在 web/.env.local 中设置模型名。",
            400,
            "missing_model",
            {
              recoveryActions: getRecoveryActions("missing_model"),
              kimiConfig: getSafeKimiConfig(),
            },
          );
        }

        try {
          const kimiResult = await callKimiForCanonicalRequirements(requirementsText);
          rawModelOutput = kimiResult.rawModelOutput;
          const canonicalParse = parseCanonicalRequirementsText(
            kimiResult.canonicalRequirementsText,
            { requirementsText },
          );
          canonicalRequirementsText = canonicalParse.canonicalRequirementsText;
          parsedOverride = canonicalParse.rules;
          canonicalWarnings = canonicalParse.warnings;
          canonicalDroppedLines = canonicalParse.droppedLines;
        } catch (error) {
          const errorInfo = getKimiErrorInfo(error);
          console.error("Kimi requirements parsing failed", {
            code: errorInfo.code,
            status: errorInfo.status,
            message: errorInfo.message,
            complexityReasons: complexity.reasons,
            kimiConfig: getSafeKimiConfig(),
          });
          return fail(`格式要求解析失败：${errorInfo.message}`, errorInfo.httpStatus, errorInfo.code, {
            recoveryActions: getRecoveryActions(errorInfo.code),
            kimiConfig: getSafeKimiConfig(),
          });
        }
      }
    }

    const rawParsedRules = parsedOverride;
    const normalizationResult = normalizeAiParsedRules(rawParsedRules, { requirementsText });
    const normalizedAiRules = normalizationResult.rules;
    const schemaValidation = validateOverrideAgainstSchema(normalizedAiRules);
    if (!schemaValidation.valid) {
      return fail(
        `格式要求解析失败：规范化清单转换出的格式规则未通过 schema 校验：${schemaValidation.errors.join("；")}`,
        400,
        "schema_validation_failed",
        {
          recoveryActions: getRecoveryActions("schema_validation_failed"),
          validationErrors: schemaValidation.errors,
          canonicalRequirementsText,
          normalizationWarnings: [...canonicalWarnings, ...normalizationResult.warnings],
        },
      );
    }

    parsedOverride = mergeWarningsIntoOverride(
      normalizedAiRules,
      [...canonicalWarnings, ...normalizationResult.warnings],
    );
    parsedOverride = mergeUnsupportedModulesIntoOverride(
      parsedOverride,
      detectUnsupportedModuleRequirements(requirementsText),
    );
    parsedOverride = mergeTocRequirementIntoOverride(
      parsedOverride,
      detectTocProtectRequirement(requirementsText),
    );
    const initialConflictResult = detectStructuredRuleConflicts(parsedOverride);
    parsedOverride = mergeWarningsIntoOverride(parsedOverride, initialConflictResult.warnings);
    parsedOverride = attachParserMetadata(parsedOverride, {
      parser_mode: mode,
      complexity_reasons: complexity.reasons,
      canonical_requirements_text: canonicalRequirementsText,
      canonical_dropped_lines: canonicalDroppedLines,
      raw_ai_rules: null,
      normalized_ai_rules: normalizedAiRules,
      parsed_rules: rawParsedRules,
      warnings: getOverrideWarnings(parsedOverride),
      unsupported_modules: getUnsupportedModules(parsedOverride),
      conflict_result: initialConflictResult,
    });
    if (mode === "local") {
      rawModelOutput = JSON.stringify(parsedOverride, null, 2);
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
        `格式要求解析失败：AI 解析出的格式规则未通过校验：${getGenericErrorMessage(error)}`,
        400,
        "schema_validation_failed",
        {
          recoveryActions: getRecoveryActions("schema_validation_failed"),
        },
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
    const conflictResult = detectStructuredRuleConflicts(normalizedOverride);
    const suspiciousWarnings = detectSuspiciousInferredFields(
      requirementsText,
      normalizedOverride,
    );
    const warnings = Array.from(
      new Set([...summary.warnings, ...conflictResult.warnings, ...suspiciousWarnings, ...mergeWarnings]),
    );
    const responseOverride = attachParserMetadata(normalizedOverride, {
      parser_mode: mode,
      complexity_reasons: complexity.reasons,
      canonical_requirements_text: canonicalRequirementsText,
      canonical_dropped_lines: canonicalDroppedLines,
      raw_ai_rules: null,
      normalized_ai_rules: normalizedAiRules,
      parsed_rules: rawParsedRules,
      validated_rules: normalizedOverride,
      warnings,
      unsupported_modules: getUnsupportedModules(normalizedOverride),
      conflict_result: conflictResult,
    });

    const payload = {
      success: true,
      message: "格式要求解析成功",
      jobId,
      mode,
      parserMode: mode,
      complexity,
      canonicalRequirementsText,
      rawModelOutput,
      parsedOverride,
      parsedRules: rawParsedRules,
      rawAiRules: null,
      normalizedAiRules,
      normalizedOverride: responseOverride,
      validatedRules: normalizedOverride,
      finalRules: finalRulesDebug,
      debugSummary: {
        ...(typeof debugSummary === "object" && debugSummary !== null ? debugSummary : {}),
        parser_mode: mode,
        canonical_requirements_text: canonicalRequirementsText,
        canonical_dropped_lines: canonicalDroppedLines,
        raw_ai_rules: null,
        normalized_ai_rules: normalizedAiRules,
        parsed_rules: rawParsedRules,
        validated_rules: normalizedOverride,
        warnings,
        unsupported_modules: getUnsupportedModules(normalizedOverride),
        conflict_result: conflictResult,
      },
      override: responseOverride,
      overriddenFields: collectOverrideFields(responseOverride),
      warnings,
      summary: summary.items,
      finalRulesPreview: getFinalRulesPreview(finalRulesDebug),
      unsupportedModules: getUnsupportedModules(normalizedOverride),
      conflictResult,
      cached: false,
    };

    rememberParseResult(cacheKey, payload);
    return NextResponse.json(payload);
  } catch (error) {
    return fail(`格式要求解析失败：${getGenericErrorMessage(error)}`, 500);
  }
}

function fail(
  message: string,
  status: number,
  errorCode = "parse_failed",
  extra: Record<string, unknown> = {},
) {
  return NextResponse.json(
    { success: false, message, errorCode, ...extra },
    { status },
  );
}

function mergeWarningsIntoOverride(override: unknown, warnings: string[]) {
  if (!warnings.length || typeof override !== "object" || override === null || Array.isArray(override)) {
    return override;
  }

  const overrideObject = override as Record<string, unknown>;
  const existingWarnings = Array.isArray(overrideObject.warnings)
    ? overrideObject.warnings.filter((warning): warning is string => typeof warning === "string")
    : [];

  return {
    ...overrideObject,
    warnings: Array.from(new Set([...existingWarnings, ...warnings])),
  };
}

function detectUnsupportedModuleRequirements(requirementsText: string) {
  const unsupportedModules: Record<
    string,
    { status: string; action: string; note: string }
  > = {};
  const add = (key: string, note: string) => {
    unsupportedModules[key] = {
      status: "detected_but_not_supported",
      action: "warning_only",
      note,
    };
  };

  if (/页眉|页脚/.test(requirementsText)) {
    add("header_footer", "检测到页眉页脚要求，但当前版本暂不处理。");
  }
  if (/页码|页数|页脚.{0,12}页码|页码.{0,12}居中/.test(requirementsText)) {
    add("page_number", "检测到页码要求，但当前版本暂不处理。");
  }
  if (/脚注/.test(requirementsText)) {
    add("footnote", "检测到脚注要求，但当前版本暂不处理。");
  }
  if (/尾注/.test(requirementsText)) {
    add("endnote", "检测到尾注要求，但当前版本暂不处理。");
  }
  if (/三线表/.test(requirementsText)) {
    add("table_three_line", "检测到三线表要求，但当前版本暂不处理。");
  }
  if (/公式/.test(requirementsText)) {
    add("formula", "检测到公式要求，但当前版本暂不处理。");
  }

  return unsupportedModules;
}

function mergeUnsupportedModulesIntoOverride(
  override: unknown,
  unsupportedModules: Record<string, { status: string; action: string; note: string }>,
) {
  if (!Object.keys(unsupportedModules).length) {
    return override;
  }
  if (typeof override !== "object" || override === null || Array.isArray(override)) {
    return override;
  }

  const overrideObject = override as Record<string, unknown>;
  const existingUnsupportedModules =
    typeof overrideObject.unsupported_modules === "object" &&
    overrideObject.unsupported_modules !== null &&
    !Array.isArray(overrideObject.unsupported_modules)
      ? (overrideObject.unsupported_modules as Record<string, unknown>)
      : {};

  return {
    ...overrideObject,
    unsupported_modules: {
      ...unsupportedModules,
      ...existingUnsupportedModules,
    },
  };
}

function detectTocProtectRequirement(requirementsText: string) {
  return /目录/.test(requirementsText) && /保持|保护|不自动生成|不生成|不自动更新|不更新/.test(requirementsText);
}

function mergeTocRequirementIntoOverride(override: unknown, shouldProtectToc: boolean) {
  if (!shouldProtectToc || typeof override !== "object" || override === null || Array.isArray(override)) {
    return override;
  }
  const overrideObject = override as Record<string, unknown>;
  if (typeof overrideObject.toc === "object" && overrideObject.toc !== null) {
    return override;
  }
  return {
    ...overrideObject,
    toc: { action: "protect" },
  };
}

function attachParserMetadata(
  override: unknown,
  parserMetadata: Record<string, unknown>,
) {
  if (typeof override !== "object" || override === null || Array.isArray(override)) {
    return override;
  }
  return {
    ...(override as Record<string, unknown>),
    parser_metadata: parserMetadata,
  };
}

function getOverrideWarnings(override: unknown) {
  if (typeof override !== "object" || override === null || Array.isArray(override)) {
    return [];
  }
  const warnings = (override as Record<string, unknown>).warnings;
  return Array.isArray(warnings)
    ? warnings.filter((warning): warning is string => typeof warning === "string")
    : [];
}

function getUnsupportedModules(override: unknown) {
  if (typeof override !== "object" || override === null || Array.isArray(override)) {
    return {};
  }
  const unsupportedModules = (override as Record<string, unknown>).unsupported_modules;
  if (
    typeof unsupportedModules === "object" &&
    unsupportedModules !== null &&
    !Array.isArray(unsupportedModules)
  ) {
    return unsupportedModules as Record<string, unknown>;
  }
  return {};
}

function getKimiErrorInfo(error: unknown): {
  code: string;
  message: string;
  status?: number;
  httpStatus: number;
} {
  if (error instanceof KimiApiError) {
    return {
      code: error.code,
      message: error.message,
      status: error.status,
      httpStatus: error.status && error.status >= 400 && error.status < 500 ? 400 : 502,
    };
  }
  if (!(error instanceof Error)) {
    return {
      code: "api_network_error",
      message: "未知错误",
      httpStatus: 502,
    };
  }
  const lowerMessage = error.message.toLowerCase();
  if (
    lowerMessage.includes("request timed out") ||
    lowerMessage.includes("timed out") ||
    lowerMessage.includes("timeout")
  ) {
    return {
      code: "api_timeout",
      message: "Kimi API 请求超时，请重试或改用本地快速解析。",
      httpStatus: 504,
    };
  }
  return {
    code: "api_network_error",
    message: error.message,
    httpStatus: 502,
  };
}

function getGenericErrorMessage(error: unknown) {
  if (!(error instanceof Error)) {
    return "未知错误";
  }
  return error.message;
}

function getSafeKimiConfig() {
  const config = getKimiRuntimeConfig();
  return {
    apiKeyConfigured: config.apiKeyConfigured,
    model: config.model,
    baseURL: config.baseURL,
    timeoutMs: config.timeoutMs,
    maxTokens: config.maxTokens,
  };
}

function getRecoveryActions(errorCode: string) {
  const baseActions = [
    {
      id: "retry_kimi",
      label: "重试 Kimi",
      description: "重新调用 Kimi 解析，不会修改 Word。",
    },
    {
      id: "use_local_parser",
      label: "改用本地快速解析",
      description: "按本地规则保守解析，复杂细分要求需要人工确认。",
    },
    {
      id: "edit_requirements",
      label: "返回修改要求编辑",
      description: "继续编辑老师格式要求后再解析。",
    },
  ];

  if (errorCode === "missing_api_key" || errorCode === "missing_model") {
    return baseActions.filter((action) => action.id !== "retry_kimi");
  }
  return baseActions;
}

function makeCacheKey(templateName: string, requirementsText: string, forceMode = "auto") {
  const requirementsHash = crypto
    .createHash("sha256")
    .update(requirementsText.replace(/\s+/g, " ").trim(), "utf8")
    .digest("hex");
  return `${templateName}::${forceMode}::${requirementsHash}`;
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
