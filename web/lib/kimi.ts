import OpenAI from "openai";

import type { OverrideRules } from "./requirements";

const DEFAULT_KIMI_BASE_URL = "https://api.moonshot.ai/v1";
const MAX_MODEL_RESPONSE_LENGTH = 100_000;
const DEFAULT_KIMI_REQUEST_TIMEOUT_MS = 100_000;
const DEFAULT_KIMI_MAX_TOKENS = 6000;
const COMPLEX_REQUIREMENTS_LENGTH = 260;

const STYLE_TARGETS = [
  "paper_title",
  "abstract_cn_title",
  "abstract_cn_content",
  "keywords_cn_label",
  "keywords_cn_content",
  "abstract_title",
  "abstract_content",
  "keywords",
  "abstract_en_title",
  "abstract_en_content",
  "keywords_en",
  "keywords_en_label",
  "keywords_en_content",
  "heading_1",
  "heading_2",
  "heading_3",
  "body",
  "table_caption",
  "figure_caption",
  "reference_title",
  "reference_item",
  "table_text",
] as const;

const STYLE_TARGET_SET = new Set<string>(STYLE_TARGETS);
const STYLE_FIELDS = new Set([
  "font",
  "size_pt",
  "size_cn",
  "bold",
  "italic",
  "underline",
  "alignment",
  "line_spacing",
  "first_line_indent_pt",
  "first_line_indent_chars",
  "hanging_indent_chars",
  "space_before_pt",
  "space_after_pt",
  "space_before_lines",
  "space_after_lines",
  "keep_with_next",
  "keep_together",
  "color",
]);
const TOP_LEVEL_FIELDS = new Set([
  "version",
  "name",
  "description",
  "page",
  "styles",
  "latin_digit_format",
  "reference_latin_digit_format",
  "toc",
  "unsupported_modules",
  "warnings",
]);
const PAGE_FIELDS = new Set([
  "top_margin_cm",
  "bottom_margin_cm",
  "left_margin_cm",
  "right_margin_cm",
]);
const LATIN_DIGIT_SCOPES = new Set(["global", "body", "abstract", "heading"]);
const REFERENCE_LATIN_DIGIT_SCOPES = new Set(["reference"]);
const UNSUPPORTED_MODULES = new Set([
  "header_footer",
  "page_number",
  "footnote",
  "endnote",
  "table_three_line",
  "formula",
  "figure_caption",
  "table_caption",
]);

const UNSUPPORTED_MODULE_ALIASES: Record<string, string> = {
  page_header: "header_footer",
  page_footer: "header_footer",
  header: "header_footer",
  footer: "header_footer",
  page_number: "page_number",
};

const STYLE_FIELD_ALIASES: Record<string, string> = {
  text_color: "color",
  font_color: "color",
};

const TOP_LEVEL_FIELD_ALIASES: Record<string, string> = {
  unsupportedModules: "unsupported_modules",
  latinDigitFormat: "latin_digit_format",
  referenceLatinDigitFormat: "reference_latin_digit_format",
};

const CANONICAL_STYLE_TARGETS: Record<string, string> = {
  论文标题: "paper_title",
  中文摘要标题: "abstract_cn_title",
  中文摘要正文: "abstract_cn_content",
  中文关键词标签: "keywords_cn_label",
  中文关键词内容: "keywords_cn_content",
  英文摘要标题: "abstract_en_title",
  英文摘要正文: "abstract_en_content",
  英文关键词标签: "keywords_en_label",
  英文关键词内容: "keywords_en_content",
  一级标题: "heading_1",
  二级标题: "heading_2",
  三级标题: "heading_3",
  正文: "body",
  参考文献标题: "reference_title",
  参考文献条目: "reference_item",
};

const CANONICAL_UNSUPPORTED_TARGETS: Record<string, string> = {
  页眉页脚: "header_footer",
  页码: "page_number",
  脚注: "footnote",
  尾注: "endnote",
  三线表: "table_three_line",
  公式: "formula",
  图题: "figure_caption",
  表题: "table_caption",
};

const CANONICAL_TARGETS = new Set([
  ...Object.keys(CANONICAL_STYLE_TARGETS),
  "正文英文数字",
  "参考文献英文数字",
  "目录",
  "页面设置",
  "全文",
  ...Object.keys(CANONICAL_UNSUPPORTED_TARGETS),
  "图片",
]);

export type KimiErrorCode =
  | "missing_api_key"
  | "missing_model"
  | "api_timeout"
  | "api_auth_failed"
  | "api_model_or_request_error"
  | "api_network_error"
  | "empty_content"
  | "output_truncated"
  | "non_json"
  | "non_object_json";

export class KimiApiError extends Error {
  code: KimiErrorCode;
  status?: number;

  constructor(code: KimiErrorCode, message: string, status?: number) {
    super(message);
    this.name = "KimiApiError";
    this.code = code;
    this.status = status;
  }
}

export function getKimiRuntimeConfig() {
  const timeoutMs = parsePositiveIntegerEnv(
    process.env.KIMI_TIMEOUT_MS,
    DEFAULT_KIMI_REQUEST_TIMEOUT_MS,
  );
  const maxTokens = parsePositiveIntegerEnv(
    process.env.KIMI_MAX_TOKENS,
    DEFAULT_KIMI_MAX_TOKENS,
  );

  return {
    apiKeyConfigured: Boolean(process.env.KIMI_API_KEY),
    model: process.env.KIMI_MODEL || "",
    baseURL: process.env.KIMI_BASE_URL || DEFAULT_KIMI_BASE_URL,
    timeoutMs,
    maxTokens,
  };
}

export function buildRequirementsPrompt(requirementsText: string) {
  const system = [
    "你是论文格式要求解析器，只能把自然语言格式要求转成严格 override JSON。",
    "Kimi 只负责解析 JSON，不读取 Word，不修改 Word，不执行命令，不生成代码。",
    "只输出一个 JSON 对象，不允许 Markdown，不允许解释文字，不允许代码块。",
    "只能使用本 schema 支持字段，不允许自造字段。",
    "顶层字段只能使用 name、description、page、styles、latin_digit_format、reference_latin_digit_format、toc、unsupported_modules、warnings。",
    "page 只能使用 top_margin_cm、bottom_margin_cm、left_margin_cm、right_margin_cm，单位是 cm 数字。",
    "styles target 只能使用 paper_title、abstract_cn_title、abstract_cn_content、keywords_cn_label、keywords_cn_content、abstract_title、abstract_content、keywords、abstract_en_title、abstract_en_content、keywords_en、keywords_en_label、keywords_en_content、heading_1、heading_2、heading_3、body、table_caption、figure_caption、reference_title、reference_item、table_text。",
    "推荐新字段：中文摘要标题用 abstract_cn_title，中文摘要正文用 abstract_cn_content；中文关键词标签用 keywords_cn_label，中文关键词内容用 keywords_cn_content；英文 Keywords 标签用 keywords_en_label，内容用 keywords_en_content。",
    "兼容旧字段 abstract_title、abstract_content、keywords、keywords_en 只在原文没有区分标题/正文或标签/内容时使用。",
    "样式字段只能使用 font、size_pt、size_cn、bold、italic、underline、alignment、line_spacing、first_line_indent_pt、first_line_indent_chars、space_before_pt、space_after_pt。",
    "alignment 只能是 left、center、right、justify；居中=center，两端对齐=justify。",
    "中文字号可用：初号、小初、一号、小一、二号、小二、三号、小三、四号、小四、五号、小五、六号、小六、七号、八号。",
    "严格忠于原文，老师明确写了什么才输出什么；不要自动补全常见论文格式。",
    "标题的 font/bold/alignment 不得复制到正文；label 的 font/bold 不得复制到 content，除非原文明确要求。",
    "正文中文字体写入 styles.body.font；正文英文和数字写入 latin_digit_format，不要写入 styles.body.font。",
    "latin_digit_format 只能使用 font、size_pt、size_cn、scope；scope 只能是 global、body、abstract、heading。英文摘要 Times New Roman 不等于全局英文数字规则。",
    "参考文献条目中文字体写入 styles.reference_item.font；参考文献中的英文、年份、卷期号、页码写入 reference_latin_digit_format，不要写入 styles.reference_item.font。",
    "reference_latin_digit_format 只能使用 font、size_pt、size_cn、scope；scope 必须是 reference。",
    "目录保持原有结构、不生成、不更新时输出 toc.action=protect。",
    "页眉页脚、页码、脚注、尾注、三线表、公式等当前不支持的要求必须写入 unsupported_modules，不要假装支持。",
    "unsupported_modules 每个模块必须包含 status=detected_but_not_supported、action=warning_only、note。",
    "不确定、模糊或 schema 不支持的要求写入 warnings 或 unsupported_modules。",
    "正例：中文摘要标题黑体小四加粗居中，输出 styles.abstract_cn_title；中文摘要正文宋体小四两端对齐，输出 styles.abstract_cn_content。",
    "正例：关键词：标签黑体加粗，内容宋体不加粗，分别输出 keywords_cn_label 与 keywords_cn_content。",
    "正例：参考文献条目宋体五号，参考文献英文数字 Times New Roman 五号，分别输出 styles.reference_item 与 reference_latin_digit_format。",
  ].join("\n");

  const user = [
    "按 schema 解析下面要求为 override JSON，只输出 JSON：",
    "",
    requirementsText,
    "",
    JSON.stringify(
      {
        name: "ai_parsed_requirements",
        description: "由 Kimi 解析老师格式要求生成",
        styles: {
          abstract_cn_title: {
            font: "黑体",
            size_cn: "小四",
            bold: true,
            alignment: "center",
          },
          abstract_cn_content: {
            font: "宋体",
            size_cn: "小四",
            line_spacing: 1.5,
            first_line_indent_chars: 2,
          },
        },
        latin_digit_format: {
          font: "Times New Roman",
          size_cn: "小四",
          scope: "body",
        },
        reference_latin_digit_format: {
          font: "Times New Roman",
          size_cn: "五号",
          scope: "reference",
        },
        toc: {
          action: "protect",
        },
        unsupported_modules: {
          page_number: {
            status: "detected_but_not_supported",
            action: "warning_only",
            note: "检测到页码要求，但当前版本暂不处理。",
          },
        },
        warnings: [],
      },
    ),
  ].join("\n");

  return { system, user };
}

export function buildCanonicalRequirementsPrompt(requirementsText: string) {
  const allowedTargets = Array.from(CANONICAL_TARGETS).join("、");
  const system = [
    "你是论文格式要求规范化助手，只把老师的自然语言要求改写成固定格式的纯文本规则清单。",
    "不要输出 JSON，不要输出 Markdown，不要解释，不要写代码块。",
    "每行只允许一种格式：目标模块：规则1；规则2；规则3",
    `目标模块必须来自白名单：${allowedTargets}。`,
    "以下是支持模块，老师写了具体格式时必须输出具体规则，严禁写暂不支持：论文标题、中文摘要标题、中文摘要正文、中文关键词标签、中文关键词内容、英文摘要标题、英文摘要正文、英文关键词标签、英文关键词内容、一级标题、二级标题、三级标题、正文、正文英文数字、参考文献标题、参考文献条目、参考文献英文数字、目录、页面设置、全文。",
    "只有页眉页脚、页码、脚注、尾注、三线表、公式、图片等当前版本不执行的模块，才输出：暂不支持；仅提醒。",
    "不确定、无法判断的要求不要猜成支持功能；但明确的字体、字号、加粗、对齐、行距、缩进、页边距必须按原文输出。",
    "正文中文字体和正文英文数字必须拆开：正文中文写“正文”，正文英文/数字写“正文英文数字”。",
    "参考文献条目中文格式和参考文献英文数字必须拆开：中文条目写“参考文献条目”，英文/数字/年份/页码/卷期号写“参考文献英文数字”。",
    "目录只允许表达保护意图，例如：目录：保护；不生成；不更新；不修改目录页码。",
    "页眉、页脚统一输出为：页眉页脚：暂不支持；仅提醒。",
    "页码输出为：页码：暂不支持；仅提醒。",
    "脚注、尾注、三线表、公式、图片等当前版本暂不支持的要求，只输出暂不支持和仅提醒。",
    "保留老师明确写出的字号、字体、加粗、对齐、行距、首行缩进、悬挂缩进、段前段后、页边距、黑色、清除下划线等规则。",
    "不要补全老师没有写出的常见论文格式。",
  ].join("\n");

  const user = [
    "把下面格式要求规范化为纯文本规则清单。只输出清单，不要输出 JSON：",
    "",
    requirementsText,
    "",
    "示例格式：",
    "中文摘要标题：黑体；小四；加粗；居中",
    "中文摘要正文：宋体；小四；1.5倍行距；首行缩进2字符；两端对齐",
    "正文英文数字：Times New Roman；小四",
    "参考文献英文数字：Times New Roman；五号",
    "页眉页脚：暂不支持；仅提醒",
    "页码：暂不支持；仅提醒",
  ].join("\n");

  return { system, user };
}

export async function callKimiForCanonicalRequirements(requirementsText: string) {
  const apiKey = process.env.KIMI_API_KEY;
  const config = getKimiRuntimeConfig();
  const model = config.model;

  if (!apiKey) {
    throw new KimiApiError(
      "missing_api_key",
      "未配置 KIMI_API_KEY，请在 web/.env.local 中配置 Kimi API Key。",
    );
  }

  if (!model) {
    throw new KimiApiError(
      "missing_model",
      "未配置 KIMI_MODEL，请在 web/.env.local 中设置模型名。",
    );
  }

  const client = new OpenAI({
    apiKey,
    baseURL: config.baseURL,
    timeout: config.timeoutMs,
  });
  const prompt = buildCanonicalRequirementsPrompt(requirementsText);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), config.timeoutMs);

  let completion;
  try {
    completion = await client.chat.completions.create(
      {
        model,
        messages: [
          { role: "system", content: prompt.system },
          { role: "user", content: prompt.user },
        ],
        max_tokens: config.maxTokens,
      },
      {
        signal: controller.signal,
        timeout: config.timeoutMs,
      },
    );
  } catch (error) {
    if (isAbortLikeError(error)) {
      throw new KimiApiError(
        "api_timeout",
        `Kimi API 请求超过 ${Math.round(config.timeoutMs / 1000)} 秒仍未完成，请重试或改用本地快速解析。`,
      );
    }
    throw normalizeKimiApiError(error);
  } finally {
    clearTimeout(timeoutId);
  }

  const choice = completion.choices[0];
  const content = choice?.message?.content;
  const finishReason = choice?.finish_reason || "";
  if (!content || !content.trim()) {
    if (finishReason === "length") {
      throw new KimiApiError(
        "output_truncated",
        "Kimi 输出预算不足，模型还没生成规范化清单就停止了。请重试，或提高 KIMI_MAX_TOKENS。",
      );
    }
    throw new KimiApiError(
      "empty_content",
      "Kimi 返回内容为空。请重试，或改用本地快速解析。",
    );
  }

  if (content.length > MAX_MODEL_RESPONSE_LENGTH) {
    throw new KimiApiError(
      "output_truncated",
      "Kimi 返回内容过长，请精简格式要求后重试。",
    );
  }

  return {
    rawModelOutput: content,
    canonicalRequirementsText: normalizeCanonicalRequirementsText(content, requirementsText),
  };
}

export async function callKimiForRequirements(requirementsText: string) {
  const apiKey = process.env.KIMI_API_KEY;
  const config = getKimiRuntimeConfig();
  const model = config.model;

  if (!apiKey) {
    throw new KimiApiError(
      "missing_api_key",
      "未配置 KIMI_API_KEY，请在 web/.env.local 中配置 Kimi API Key。",
    );
  }

  if (!model) {
    throw new KimiApiError(
      "missing_model",
      "未配置 KIMI_MODEL，请在 web/.env.local 中设置模型名。",
    );
  }

  const client = new OpenAI({
    apiKey,
    baseURL: config.baseURL,
    timeout: config.timeoutMs,
  });
  const prompt = buildRequirementsPrompt(requirementsText);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), config.timeoutMs);

  let completion;
  try {
    completion = await client.chat.completions.create(
      {
        model,
        messages: [
          { role: "system", content: prompt.system },
          { role: "user", content: prompt.user },
        ],
        max_tokens: config.maxTokens,
      },
      {
        signal: controller.signal,
        timeout: config.timeoutMs,
      },
    );
  } catch (error) {
    if (isAbortLikeError(error)) {
      throw new KimiApiError(
        "api_timeout",
        `Kimi API 请求超过 ${Math.round(config.timeoutMs / 1000)} 秒仍未完成，请重试或改用本地快速解析。`,
      );
    }
    throw normalizeKimiApiError(error);
  } finally {
    clearTimeout(timeoutId);
  }

  const choice = completion.choices[0];
  const content = choice?.message?.content;
  const finishReason = choice?.finish_reason || "";
  if (!content || !content.trim()) {
    if (finishReason === "length") {
      throw new KimiApiError(
        "output_truncated",
        "Kimi 输出预算不足，模型还没生成 JSON 就停止了。请重试，或提高 KIMI_MAX_TOKENS。",
      );
    }
    throw new KimiApiError(
      "empty_content",
      "Kimi 返回内容为空。请重试，或改用本地快速解析。",
    );
  }

  if (content.length > MAX_MODEL_RESPONSE_LENGTH) {
    throw new KimiApiError(
      "output_truncated",
      "Kimi 返回内容过长，请精简格式要求后重试。",
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJsonFromModelResponse(content));
  } catch {
    throw new KimiApiError(
      "non_json",
      "Kimi 返回内容不是合法 JSON。请重试，或调整格式要求后再解析。",
    );
  }

  if (!isPlainObject(parsed)) {
    throw new KimiApiError(
      "non_object_json",
      "Kimi 返回内容必须是 JSON 对象。",
    );
  }

  return {
    rawModelOutput: content,
    parsedOverride: parsed as OverrideRules,
  };
}

export type RequirementParseMode = "local" | "kimi_canonical";

export function analyzeRequirementComplexity(requirementsText: string): {
  shouldUseKimi: boolean;
  reasons: string[];
  parserMode: RequirementParseMode;
} {
  const compactText = requirementsText.replace(/\s+/g, "");
  const reasons: string[] = [];

  if (/(?:中文)?摘要.{0,20}(标题|题名).{0,80}(正文|内容)|(?:中文)?摘要.{0,20}(正文|内容).{0,80}(标题|题名)/.test(compactText)) {
    reasons.push("同时出现中文摘要标题和摘要正文要求");
  }
  if (/英文摘要|Abstract/i.test(requirementsText)) {
    if (/(标题|题名|正文|内容)|Abstract.{0,80}(This|The|英文摘要正文)/i.test(requirementsText)) {
      reasons.push("出现英文摘要标题/正文语义");
    }
  }
  if (/(关键词|关键字).{0,20}(标签|冒号|内容|词条|后面|正文)/.test(compactText)) {
    reasons.push("出现中文关键词标签/内容要求");
  }
  if (/(Keywords|Key\s*words).{0,40}(label|content|标签|内容|冒号|后面)/i.test(requirementsText)) {
    reasons.push("出现英文 Keywords 标签/内容要求");
  }
  if (/参考文献.{0,40}(英文|英文字母|期刊名|卷期号|页码|年份).{0,80}Times\s*New\s*Roman/i.test(requirementsText)) {
    reasons.push("出现参考文献英文数字字符级要求");
  }
  if (/(页眉|页脚|页码|脚注|尾注|三线表|公式)/.test(compactText)) {
    reasons.push("出现当前版本暂不支持模块");
  }
  if (
    hasExplicitLatinDigitTarget(requirementsText) &&
    !/正文/.test(requirementsText) &&
    /(中文|全文|参考文献|摘要|关键词)/.test(requirementsText)
  ) {
    reasons.push("英文数字字符级要求作用范围不只正文");
  }

  const moduleHits = countRequirementModules(requirementsText);
  const hasInternalSplit =
    /(摘要.{0,20}(标题|正文|内容)|关键词.{0,20}(标签|内容)|Keywords.{0,40}(标签|内容)|参考文献.{0,40}(英文|数字|年份|页码|卷期号))/i.test(
      requirementsText,
    );
  if (moduleHits >= 4 && hasInternalSplit) {
    reasons.push("多个模块包含细分格式要求");
  }
  if (requirementsText.length >= COMPLEX_REQUIREMENTS_LENGTH && moduleHits >= 4) {
    reasons.push("格式要求较长且包含多个模块");
  }

  return {
    shouldUseKimi: reasons.length > 0,
    reasons: Array.from(new Set(reasons)),
    parserMode: reasons.length > 0 ? "kimi_canonical" : "local",
  };
}

export function validateOverrideAgainstSchema(rules: unknown): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  if (!isPlainObject(rules)) {
    return { valid: false, errors: ["规则必须是 JSON 对象。"] };
  }

  for (const field of Object.keys(rules)) {
    if (!TOP_LEVEL_FIELDS.has(field)) {
      errors.push(`顶层字段 ${field} 不在 schema 中。`);
    }
  }

  validatePageSchema(rules.page, errors);
  validateStylesSchema(rules.styles, errors);
  validateCharacterFormatSchema(
    rules.latin_digit_format,
    "latin_digit_format",
    LATIN_DIGIT_SCOPES,
    errors,
  );
  validateCharacterFormatSchema(
    rules.reference_latin_digit_format,
    "reference_latin_digit_format",
    REFERENCE_LATIN_DIGIT_SCOPES,
    errors,
  );
  validateTocSchema(rules.toc, errors);
  validateUnsupportedModulesSchema(rules.unsupported_modules, errors);
  if (
    Object.prototype.hasOwnProperty.call(rules, "warnings") &&
    !(
      Array.isArray(rules.warnings) &&
      rules.warnings.every((warning) => typeof warning === "string")
    )
  ) {
    errors.push("warnings 必须是字符串数组。");
  }

  return { valid: errors.length === 0, errors };
}

export type CanonicalParseResult = {
  canonicalRequirementsText: string;
  rules: OverrideRules;
  warnings: string[];
  droppedLines: string[];
};

export function parseCanonicalRequirementsText(
  rawCanonicalText: string,
  options: { requirementsText?: string } = {},
): CanonicalParseResult {
  const warnings: string[] = [];
  const droppedLines: string[] = [];
  let canonicalRequirementsText = normalizeCanonicalRequirementsText(
    rawCanonicalText,
    options.requirementsText || "",
  );

  if (looksLikeJson(canonicalRequirementsText)) {
    const fallbackText = extractCanonicalTextFromJson(canonicalRequirementsText);
    warnings.push(
      fallbackText
        ? "Kimi 返回了 JSON 包装，已只读取其中的规范化清单文本，未直接采用 JSON 规则。"
        : "Kimi 返回了 JSON，已忽略 JSON 字段并改用本地规范化清单兜底，未直接采用 JSON 规则。",
    );
    canonicalRequirementsText =
      fallbackText || mockCanonicalRequirementsText(options.requirementsText || "");
  }

  if (
    options.requirementsText &&
    hasUnsupportedMarkerOnSupportedTargets(canonicalRequirementsText)
  ) {
    warnings.push(
      "Kimi 将支持模块标记为暂不支持，已改用本地规范化清单兜底，未直接采用错误清单。",
    );
    canonicalRequirementsText = mockCanonicalRequirementsText(options.requirementsText);
  }

  canonicalRequirementsText = normalizeCanonicalRequirementsText(
    canonicalRequirementsText,
    options.requirementsText || "",
  );
  const rules: OverrideRules = {
    name: "canonical_parsed_requirements",
    description: "由规范化格式要求清单转换生成",
  };

  for (const line of splitCanonicalLines(canonicalRequirementsText)) {
    const parsedLine = parseCanonicalLine(line);
    if (!parsedLine) {
      droppedLines.push(line);
      warnings.push(`规范化清单行无法识别，已忽略：${line}`);
      continue;
    }

    const { target, ruleText } = parsedLine;
    if (!CANONICAL_TARGETS.has(target)) {
      droppedLines.push(line);
      warnings.push(`规范化清单目标模块不在白名单中，已忽略：${target}`);
      continue;
    }

    applyCanonicalLine(rules, target, ruleText, warnings);
  }

  if (warnings.length) {
    rules.warnings = Array.from(new Set(warnings));
  }

  return {
    canonicalRequirementsText,
    rules,
    warnings: Array.from(new Set(warnings)),
    droppedLines,
  };
}

export type NormalizeAiRulesResult = {
  rules: OverrideRules;
  warnings: string[];
  normalizedFields: string[];
  droppedFields: string[];
};

export function normalizeAiParsedRules(
  rawRules: unknown,
  options: { requirementsText?: string } = {},
): NormalizeAiRulesResult {
  const warnings: string[] = [];
  const normalizedFields: string[] = [];
  const droppedFields: string[] = [];

  if (!isPlainObject(rawRules)) {
    return {
      rules: rawRules as OverrideRules,
      warnings,
      normalizedFields,
      droppedFields,
    };
  }

  const normalized: Record<string, unknown> = {};
  let rawUnsupportedModules: unknown;

  for (const [field, value] of Object.entries(rawRules)) {
    const canonicalField = TOP_LEVEL_FIELD_ALIASES[field] || field;
    if (field !== canonicalField) {
      normalizedFields.push(`${field} -> ${canonicalField}`);
      warnings.push(`已将 AI 字段 ${field} 规范化为 ${canonicalField}。`);
    }

    if (canonicalField === "unsupported_modules") {
      rawUnsupportedModules = value;
      continue;
    }

    if (!TOP_LEVEL_FIELDS.has(canonicalField)) {
      droppedFields.push(field);
      warnings.push(`AI 返回了当前 schema 不支持的顶层字段 ${field}，已忽略。`);
      continue;
    }

    if (canonicalField === "styles") {
      normalized.styles = normalizeAiStyles(value, warnings, normalizedFields, droppedFields);
    } else if (canonicalField === "page") {
      normalized.page = normalizeKnownObjectFields(
        value,
        "page",
        PAGE_FIELDS,
        warnings,
        droppedFields,
      );
    } else if (
      canonicalField === "latin_digit_format" ||
      canonicalField === "reference_latin_digit_format"
    ) {
      normalized[canonicalField] = normalizeKnownObjectFields(
        value,
        canonicalField,
        new Set(["font", "size_pt", "size_cn", "scope"]),
        warnings,
        droppedFields,
      );
    } else if (canonicalField === "toc") {
      normalized.toc = normalizeKnownObjectFields(
        value,
        "toc",
        new Set(["action"]),
        warnings,
        droppedFields,
      );
    } else if (canonicalField === "warnings") {
      normalized.warnings = normalizeAiWarnings(value, warnings);
    } else {
      normalized[canonicalField] = value;
    }
  }

  const normalizedUnsupportedModules = normalizeAiUnsupportedModules(
    rawUnsupportedModules,
    normalized,
    options.requirementsText || "",
    warnings,
    normalizedFields,
    droppedFields,
  );
  if (normalizedUnsupportedModules && Object.keys(normalizedUnsupportedModules).length) {
    normalized.unsupported_modules = normalizedUnsupportedModules;
  }

  if (warnings.length) {
    const existingWarnings = Array.isArray(normalized.warnings)
      ? normalized.warnings.filter((warning): warning is string => typeof warning === "string")
      : [];
    normalized.warnings = Array.from(new Set([...existingWarnings, ...warnings]));
  }

  return {
    rules: normalized as OverrideRules,
    warnings: Array.from(new Set(warnings)),
    normalizedFields,
    droppedFields,
  };
}

export type ConflictResult = {
  hasConflicts: boolean;
  warnings: string[];
  conflicts: Array<{
    target: string;
    field: string;
    scope: string;
    values: string[];
  }>;
};

export function detectStructuredRuleConflicts(rules: unknown): ConflictResult {
  const conflicts: ConflictResult["conflicts"] = [];
  const warnings: string[] = [];
  const seen = new Map<string, { value: string; displayValue: string }>();

  if (!isPlainObject(rules)) {
    return { hasConflicts: false, warnings, conflicts };
  }

  if (isPlainObject(rules.styles)) {
    for (const [target, config] of Object.entries(rules.styles)) {
      if (!isPlainObject(config)) {
        continue;
      }
      for (const [field, value] of Object.entries(config)) {
        const conflictField = getConflictField(field);
        if (!conflictField) {
          continue;
        }
        rememberConflictCandidate(
          seen,
          conflicts,
          warnings,
          `styles.${target}`,
          conflictField,
          "paragraph",
          value,
          config,
          field,
        );
      }
    }
  }

  for (const [target, config, defaultScope] of [
    ["latin_digit_format", rules.latin_digit_format, "global"],
    ["reference_latin_digit_format", rules.reference_latin_digit_format, "reference"],
  ] as Array<[string, unknown, string]>) {
    if (!isPlainObject(config)) {
      continue;
    }
    const scope = typeof config.scope === "string" ? config.scope : defaultScope;
    for (const [field, value] of Object.entries(config)) {
      const conflictField = getConflictField(field);
      if (!conflictField || field === "scope") {
        continue;
      }
      rememberConflictCandidate(
        seen,
        conflicts,
        warnings,
        target,
        conflictField,
        scope,
        value,
        config,
        field,
      );
    }
  }

  return {
    hasConflicts: conflicts.length > 0,
    warnings,
    conflicts,
  };
}

export function mockParseRequirements(requirementsText: string): OverrideRules {
  if (analyzeRequirementComplexity(requirementsText).shouldUseKimi) {
    return mockParseComplexRequirements(requirementsText);
  }

  const compactText = requirementsText.replace(/\s+/g, "");
  const page = parsePageConfig(requirementsText);
  const styles: NonNullable<OverrideRules["styles"]> = {};
  const latinDigitFormat = parseLatinDigitFormat(requirementsText);

  if (/正文/.test(compactText) || /宋体小四/.test(compactText)) {
    styles.body = {};
    if (/正文[^。；;，,]*宋体|宋体小四/.test(compactText)) {
      styles.body.font = "宋体";
    }
    if (/小四/.test(compactText)) {
      styles.body.size_cn = "小四";
    }
    if (/1\.5倍|1.5倍|一点五倍/.test(compactText)) {
      styles.body.line_spacing = 1.5;
    }
    if (/首行缩进?2字符|首行缩进?两个字符/.test(compactText)) {
      styles.body.first_line_indent_chars = 2;
    }
  }

  if (/一级标题|一[级級]标题|一[级級]標題/.test(compactText)) {
    styles.heading_1 = {};
    if (/一级标题[^。；;，,]*黑体|黑体小三/.test(compactText)) {
      styles.heading_1.font = "黑体";
    }
    if (/一级标题[^。；;，,]*小三|黑体小三/.test(compactText)) {
      styles.heading_1.size_cn = "小三";
    }
    if (/一级标题[^。；;，,]*居中|黑体小三居中/.test(compactText)) {
      styles.heading_1.alignment = "center";
    }
  }

  if (/二级标题/.test(compactText)) {
    styles.heading_2 = {};
    if (/二级标题[^。；;，,]*黑体/.test(compactText)) {
      styles.heading_2.font = "黑体";
    }
    if (/二级标题[^。；;，,]*四号/.test(compactText)) {
      styles.heading_2.size_cn = "四号";
    }
    if (/二级标题[^。；;，,]*居中/.test(compactText)) {
      styles.heading_2.alignment = "center";
    }
  }

  if (/图题|表题/.test(compactText)) {
    const captionStyle: Record<string, unknown> = {};
    if (/图题和表题[^。；;，,]*宋体|图题[^。；;，,]*宋体|表题[^。；;，,]*宋体/.test(compactText)) {
      captionStyle.font = "宋体";
    }
    if (/图题和表题[^。；;，,]*五号|图题[^。；;，,]*五号|表题[^。；;，,]*五号/.test(compactText)) {
      captionStyle.size_cn = "五号";
    }
    if (/图题和表题[^。；;，,]*居中|图题[^。；;，,]*居中|表题[^。；;，,]*居中/.test(compactText)) {
      captionStyle.alignment = "center";
    }
    if (/图题/.test(compactText)) {
      styles.figure_caption = { ...captionStyle };
    }
    if (/表题/.test(compactText)) {
      styles.table_caption = { ...captionStyle };
    }
  }

  if (/参考文献标题|参考文献题名/.test(compactText)) {
    styles.reference_title = {};
    if (/参考文献(?:标题|题名)[^。；;，,]*宋体/.test(compactText)) {
      styles.reference_title.font = "宋体";
    }
    if (/参考文献(?:标题|题名)[^。；;，,]*五号/.test(compactText)) {
      styles.reference_title.size_cn = "五号";
    }
    if (/参考文献(?:标题|题名)[^。；;，,]*居中/.test(compactText)) {
      styles.reference_title.alignment = "center";
    }
  }

  if (/参考文献(?!标题|题名)|参考文献条目|文献条目/.test(compactText)) {
    styles.reference_item = {};
    if (/(参考文献(?!标题|题名)|参考文献条目|文献条目)[^。；;，,]*宋体/.test(compactText)) {
      styles.reference_item.font = "宋体";
    }
    if (/(参考文献(?!标题|题名)|参考文献条目|文献条目)[^。；;，,]*五号/.test(compactText)) {
      styles.reference_item.size_cn = "五号";
    }
  }

  if (Object.keys(styles).length === 0 && Object.keys(page).length === 0 && !latinDigitFormat) {
    styles.body = {
      font: "宋体",
      size_cn: "小四",
    };
  }

  return {
    name: "mock_ai_parsed_requirements",
    description: "本地 mock 解析结果，仅用于开发测试",
    ...(Object.keys(page).length > 0 ? { page } : {}),
    ...(latinDigitFormat ? { latin_digit_format: latinDigitFormat } : {}),
    styles,
    warnings: [
      "当前为 mock 解析结果，仅用于本地开发测试。正式使用请配置 KIMI_API_KEY。",
    ],
  };
}

export function tryParseRequirementsLocally(
  requirementsText: string,
  options: { allowComplex?: boolean } = {},
): OverrideRules | null {
  const complexity = analyzeRequirementComplexity(requirementsText);
  if (complexity.shouldUseKimi && !options.allowComplex) {
    return null;
  }

  const page: NonNullable<OverrideRules["page"]> = parsePageConfig(requirementsText);
  const styles: NonNullable<OverrideRules["styles"]> = {};
  const latinDigitFormat = parseLatinDigitFormat(requirementsText);
  const localConflictWarnings: string[] = [];
  const blocks = requirementsText
    .split(/[；;。\n\r]+/)
    .map((block) => block.trim())
    .filter(Boolean);

  for (const block of blocks) {
    let currentTargets: string[] = [];
    const segments = block
      .split(/[，,]+/)
      .map((segment) => segment.trim())
      .filter(Boolean);

    for (const segment of segments) {
      Object.assign(page, parsePageConfig(segment));
      if (isLatinDigitOnlyClause(segment)) {
        continue;
      }

      const detectedTargets = detectStyleTargets(segment);
      if (detectedTargets.length > 0) {
        currentTargets = detectedTargets;
      }

      if (currentTargets.length === 0) {
        continue;
      }

      const styleConfig = parseStyleConfig(segment);
      if (Object.keys(styleConfig).length === 0) {
        continue;
      }

      for (const target of currentTargets) {
        collectStyleMergeConflictWarnings(
          styles[target],
          styleConfig,
          target,
          localConflictWarnings,
        );
        styles[target] = {
          ...(styles[target] || {}),
          ...styleConfig,
        };
      }
    }
  }

  if (Object.keys(styles).length === 0 && Object.keys(page).length === 0 && !latinDigitFormat) {
    return null;
  }

  return {
    name: "local_parsed_requirements",
    description: "本地规则快速解析结果",
    ...(Object.keys(page).length > 0 ? { page } : {}),
    ...(Object.keys(styles).length > 0 ? { styles } : {}),
    ...(latinDigitFormat ? { latin_digit_format: latinDigitFormat } : {}),
    warnings: [
      options.allowComplex
        ? "已按用户选择改用本地快速解析；复杂细分要求可能无法完整识别，请重点人工确认。"
        : "已使用本地快速解析，复杂或含糊要求仍建议人工确认。",
      ...localConflictWarnings,
    ],
  };
}

export function detectRequirementConflicts(rules: unknown): string[] {
  return detectStructuredRuleConflicts(rules).warnings;
}

export function detectSuspiciousInferredFields(
  requirementsText: string,
  override: unknown,
): string[] {
  if (!isPlainObject(override) || !isPlainObject(override.styles)) {
    return [];
  }

  const warnings: string[] = [];
  const styles = override.styles as Record<string, unknown>;

  const heading1 = isPlainObject(styles.heading_1) ? styles.heading_1 : null;
  if (
    heading1 &&
    Object.prototype.hasOwnProperty.call(heading1, "alignment") &&
    !hasNearbyRequirement(requirementsText, ["一级标题", "一級标题", "一级標題"], ALIGNMENT_WORDS)
  ) {
    warnings.push("一级标题包含对齐方式，但原文未明显提到对齐要求，请确认是否为 AI 过度推断。");
  }

  const referenceItem = isPlainObject(styles.reference_item) ? styles.reference_item : null;
  if (
    referenceItem &&
    Object.prototype.hasOwnProperty.call(referenceItem, "alignment") &&
    !hasNearbyRequirement(requirementsText, ["参考文献"], ALIGNMENT_WORDS)
  ) {
    warnings.push("参考文献条目包含对齐方式，但原文未明显提到，请确认。");
  }

  if (
    referenceItem &&
    Object.prototype.hasOwnProperty.call(referenceItem, "line_spacing") &&
    !hasNearbyRequirement(requirementsText, ["参考文献"], LINE_SPACING_WORDS)
  ) {
    warnings.push("参考文献条目包含行距设置，但原文未明显提到，请确认。");
  }

  if (hasAnyBoldTrue(styles) && !/加粗/.test(requirementsText)) {
    warnings.push("检测到加粗设置，但原文未明显提到加粗，请确认。");
  }

  return warnings;
}

export function extractJsonFromModelResponse(text: string) {
  const trimmed = text.trim();
  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fencedMatch?.[1]) {
    return fencedMatch[1].trim();
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }

  return trimmed;
}

export function mockCanonicalRequirementsText(requirementsText: string) {
  const lines: string[] = [];
  const page = parsePageConfig(requirementsText);

  if (/论文标题|文章标题|题目/.test(requirementsText)) {
    lines.push("论文标题：黑体；三号；加粗；居中");
  }
  if (/摘要/.test(requirementsText)) {
    lines.push("中文摘要标题：黑体；小四；加粗；居中");
    lines.push("中文摘要正文：宋体；小四；1.5倍行距；首行缩进2字符；两端对齐");
  }
  if (/关键词|关键字/.test(requirementsText)) {
    lines.push("中文关键词标签：黑体；小四；加粗");
    lines.push("中文关键词内容：宋体；小四；不加粗");
  }
  if (/英文摘要|Abstract/i.test(requirementsText)) {
    lines.push("英文摘要标题：Times New Roman；小四；加粗；居中");
    lines.push("英文摘要正文：Times New Roman；小四；1.5倍行距；两端对齐；首行缩进0");
  }
  if (/Keywords|Key\s*words|英文关键词/i.test(requirementsText)) {
    lines.push("英文关键词标签：Times New Roman；小四；加粗");
    lines.push("英文关键词内容：Times New Roman；小四；不加粗");
  }
  if (/一级标题|一[级級]标题/.test(requirementsText)) {
    lines.push("一级标题：黑体；小三；加粗；左对齐");
  }
  if (/二级标题|二[级級]标题/.test(requirementsText)) {
    lines.push("二级标题：黑体；四号；加粗；左对齐");
  }
  if (/三级标题|三[级級]标题/.test(requirementsText)) {
    lines.push("三级标题：黑体；小四；加粗；左对齐");
  }
  if (/正文|宋体小四/.test(requirementsText)) {
    lines.push("正文：宋体；小四；1.5倍行距；首行缩进2字符；两端对齐");
  }
  if (/正文.{0,40}(英文|数字).{0,80}Times\s*New\s*Roman/i.test(requirementsText)) {
    lines.push("正文英文数字：Times New Roman；小四");
  }
  if (/参考文献/.test(requirementsText)) {
    if (/参考文献.{0,20}(标题|题名)/.test(requirementsText)) {
      lines.push("参考文献标题：黑体；四号；加粗；居中");
    }
    lines.push(`参考文献条目：宋体；${/五号/.test(requirementsText) ? "五号" : "小四"}`);
  }
  if (shouldAddReferenceLatinDigitFormat(requirementsText)) {
    lines.push("参考文献英文数字：Times New Roman；五号");
  }
  if (/目录/.test(requirementsText)) {
    lines.push("目录：保护；不生成；不更新；不修改目录页码");
  }
  if (Object.keys(page).length) {
    const pageRules = [
      typeof page.top_margin_cm === "number" ? `上边距${page.top_margin_cm}厘米` : "",
      typeof page.bottom_margin_cm === "number" ? `下边距${page.bottom_margin_cm}厘米` : "",
      typeof page.left_margin_cm === "number" ? `左边距${page.left_margin_cm}厘米` : "",
      typeof page.right_margin_cm === "number" ? `右边距${page.right_margin_cm}厘米` : "",
    ].filter(Boolean);
    if (pageRules.length) {
      lines.push(`页面设置：${pageRules.join("；")}`);
    }
  }
  if (/黑色|清除.{0,12}下划线|取消.{0,12}下划线|去除.{0,12}下划线/.test(requirementsText)) {
    const textRules = [
      /黑色/.test(requirementsText) ? "黑色" : "",
      /清除.{0,12}下划线|取消.{0,12}下划线|去除.{0,12}下划线/.test(requirementsText)
        ? "清除下划线"
        : "",
    ].filter(Boolean);
    lines.push(`全文：${textRules.join("；")}`);
  }
  if (/页眉|页脚/.test(requirementsText)) {
    lines.push("页眉页脚：暂不支持；仅提醒");
  }
  if (/页码|页数/.test(requirementsText)) {
    lines.push("页码：暂不支持；仅提醒");
  }
  if (/脚注/.test(requirementsText)) {
    lines.push("脚注：暂不支持；仅提醒");
  }
  if (/尾注/.test(requirementsText)) {
    lines.push("尾注：暂不支持；仅提醒");
  }
  if (/三线表/.test(requirementsText)) {
    lines.push("三线表：暂不支持；仅提醒");
  }
  if (/公式/.test(requirementsText)) {
    lines.push("公式：暂不支持；仅提醒");
  }

  if (!lines.length) {
    const localRules = tryParseRequirementsLocally(requirementsText, { allowComplex: true });
    if (localRules?.styles?.body) {
      lines.push(`正文：${describeStyleAsCanonicalRules(localRules.styles.body)}`);
    }
  }

  return Array.from(new Set(lines)).join("\n");
}

function normalizeCanonicalRequirementsText(rawText: string, requirementsText: string) {
  const trimmed = rawText.trim();
  const fenceMatch = trimmed.match(/^```(?:text|txt|json)?\s*([\s\S]*?)\s*```$/i);
  const unfenced = (fenceMatch ? fenceMatch[1] : trimmed).trim();
  if (unfenced) {
    return unfenced
      .split(/\r?\n/)
      .map((line) => normalizeCanonicalLineText(line))
      .filter(Boolean)
      .join("\n");
  }
  return mockCanonicalRequirementsText(requirementsText);
}

function normalizeCanonicalLineText(line: string) {
  return line
    .trim()
    .replace(/^[-*]\s*/, "")
    .replace(/^\d+[.)、]\s*/, "")
    .replace(/\s*:\s*/, "：")
    .replace(/\s*；\s*/g, "；")
    .replace(/\s+/g, " ");
}

function splitCanonicalLines(text: string) {
  return text
    .split(/\r?\n/)
    .map((line) => normalizeCanonicalLineText(line))
    .filter(Boolean);
}

function parseCanonicalLine(line: string) {
  const match = line.match(/^([^：:]+)[：:](.+)$/);
  if (!match) {
    return null;
  }
  return {
    target: match[1].trim(),
    ruleText: match[2].trim(),
  };
}

function applyCanonicalLine(
  rules: OverrideRules,
  target: string,
  ruleText: string,
  warnings: string[],
) {
  const styleTarget = CANONICAL_STYLE_TARGETS[target];
  if (styleTarget) {
    rules.styles ??= {};
    rules.styles[styleTarget] = {
      ...(rules.styles[styleTarget] || {}),
      ...parseCanonicalStyleConfig(ruleText),
    };
    return;
  }

  if (target === "正文英文数字") {
    rules.latin_digit_format = {
      ...(rules.latin_digit_format || {}),
      ...parseCanonicalCharacterFormat(ruleText),
      scope: "body",
    };
    return;
  }

  if (target === "参考文献英文数字") {
    rules.reference_latin_digit_format = {
      ...(rules.reference_latin_digit_format || {}),
      ...parseCanonicalCharacterFormat(ruleText),
      scope: "reference",
    };
    return;
  }

  if (target === "页面设置") {
    const page = parsePageConfig(ruleText);
    if (Object.keys(page).length) {
      rules.page = { ...(rules.page || {}), ...page };
    }
    return;
  }

  if (target === "目录") {
    if (/保护|不生成|不更新|不修改/.test(ruleText)) {
      rules.toc = { action: "protect" };
    }
    return;
  }

  if (target === "全文") {
    const globalStyle = parseCanonicalStyleConfig(ruleText);
    if (Object.keys(globalStyle).length) {
      rules.styles ??= {};
      rules.styles.body = {
        ...(rules.styles.body || {}),
        ...globalStyle,
      };
    }
    return;
  }

  const unsupportedKey = CANONICAL_UNSUPPORTED_TARGETS[target];
  if (unsupportedKey) {
    rules.unsupported_modules ??= {};
    rules.unsupported_modules[unsupportedKey] = {
      status: "detected_but_not_supported",
      action: "warning_only",
      note: getDefaultUnsupportedModuleNote(unsupportedKey),
    };
    return;
  }

  if (target === "图片") {
    warnings.push("检测到图片要求，但当前 schema 没有图片模块，已仅作为提醒忽略。");
  }
}

function parseCanonicalStyleConfig(ruleText: string) {
  const config = parseStyleConfig(ruleText);
  if (/黑色|black/i.test(ruleText)) {
    config.color = "000000";
  }
  const hangingIndentChars = parseHangingIndentChars(ruleText);
  if (typeof hangingIndentChars === "number") {
    config.hanging_indent_chars = hangingIndentChars;
  }
  const spaceBeforeLines = parseLineBasedSpacing(ruleText, "段前");
  if (typeof spaceBeforeLines === "number") {
    config.space_before_lines = spaceBeforeLines;
  }
  const spaceAfterLines = parseLineBasedSpacing(ruleText, "段后");
  if (typeof spaceAfterLines === "number") {
    config.space_after_lines = spaceAfterLines;
  }
  return config;
}

function parseCanonicalCharacterFormat(ruleText: string) {
  const config: Record<string, unknown> = {};
  const font = parseFont(ruleText);
  const sizeCn = parseChineseSize(ruleText);
  if (font) {
    config.font = font;
  }
  if (sizeCn) {
    config.size_cn = sizeCn;
  }
  return config;
}

function parseHangingIndentChars(ruleText: string) {
  const match = ruleText.match(/悬挂缩进\s*(\d+(?:\.\d+)?)\s*(字符|字)/);
  if (!match) {
    return null;
  }
  return Number(match[1]);
}

function parseLineBasedSpacing(ruleText: string, label: "段前" | "段后") {
  const match = ruleText.match(new RegExp(`${label}\\s*(\\d+(?:\\.\\d+)?)\\s*行`));
  if (!match) {
    return null;
  }
  return Number(match[1]);
}

function describeStyleAsCanonicalRules(style: Record<string, unknown>) {
  const rules = [
    typeof style.font === "string" ? style.font : "",
    typeof style.size_cn === "string" ? style.size_cn : "",
    typeof style.line_spacing === "number" ? `${style.line_spacing}倍行距` : "",
    typeof style.first_line_indent_chars === "number"
      ? `首行缩进${style.first_line_indent_chars}字符`
      : "",
    style.alignment === "center"
      ? "居中"
      : style.alignment === "left"
        ? "左对齐"
        : style.alignment === "right"
          ? "右对齐"
          : style.alignment === "justify"
            ? "两端对齐"
            : "",
  ].filter(Boolean);
  return rules.join("；");
}

function looksLikeJson(text: string) {
  const trimmed = text.trim();
  return trimmed.startsWith("{") || trimmed.startsWith("[");
}

function extractCanonicalTextFromJson(text: string) {
  try {
    const parsed = JSON.parse(extractJsonFromModelResponse(text));
    if (!isPlainObject(parsed)) {
      return "";
    }
    for (const key of [
      "canonicalRequirementsText",
      "canonical_requirements_text",
      "requirements",
      "text",
    ]) {
      const value = parsed[key];
      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }
    }
  } catch {
    return "";
  }
  return "";
}

function hasUnsupportedMarkerOnSupportedTargets(text: string) {
  return splitCanonicalLines(text).some((line) => {
    const parsedLine = parseCanonicalLine(line);
    if (!parsedLine) {
      return false;
    }
    const isSupportedTarget =
      Boolean(CANONICAL_STYLE_TARGETS[parsedLine.target]) ||
      parsedLine.target === "正文英文数字" ||
      parsedLine.target === "参考文献英文数字" ||
      parsedLine.target === "目录" ||
      parsedLine.target === "页面设置" ||
      parsedLine.target === "全文";
    return isSupportedTarget && /暂不支持|仅提醒/.test(parsedLine.ruleText);
  });
}

function countRequirementModules(text: string) {
  const patterns = [
    /论文标题|文章标题|题目/,
    /中文?摘要|摘要/,
    /英文?摘要|Abstract/i,
    /关键词|关键字/,
    /Keywords|Key\s*words/i,
    /目录/,
    /一级标题|二级标题|三级标题|标题层级/,
    /正文/,
    /参考文献/,
    /页眉|页脚|页码/,
  ];
  return patterns.filter((pattern) => pattern.test(text)).length;
}

function validatePageSchema(page: unknown, errors: string[]) {
  if (page === undefined) {
    return;
  }
  if (!isPlainObject(page)) {
    errors.push("page 必须是对象。");
    return;
  }
  for (const [field, value] of Object.entries(page)) {
    if (!PAGE_FIELDS.has(field)) {
      errors.push(`page.${field} 不在 schema 中。`);
    } else if (typeof value !== "number") {
      errors.push(`page.${field} 必须是数字。`);
    }
  }
}

function validateStylesSchema(styles: unknown, errors: string[]) {
  if (styles === undefined) {
    return;
  }
  if (!isPlainObject(styles)) {
    errors.push("styles 必须是对象。");
    return;
  }
  for (const [target, config] of Object.entries(styles)) {
    if (!STYLE_TARGET_SET.has(target)) {
      errors.push(`styles.${target} 不在 schema 中。`);
      continue;
    }
    if (!isPlainObject(config)) {
      errors.push(`styles.${target} 必须是对象。`);
      continue;
    }
    for (const [field, value] of Object.entries(config)) {
      if (!STYLE_FIELDS.has(field)) {
        errors.push(`styles.${target}.${field} 不在 schema 中。`);
        continue;
      }
      validateStyleFieldValue(`styles.${target}.${field}`, field, value, errors);
    }
  }
}

function validateStyleFieldValue(
  path: string,
  field: string,
  value: unknown,
  errors: string[],
) {
  if (["font", "size_cn", "color"].includes(field) && typeof value !== "string") {
    errors.push(`${path} 必须是字符串。`);
  }
  if (
    [
      "size_pt",
      "line_spacing",
      "first_line_indent_pt",
      "first_line_indent_chars",
      "hanging_indent_chars",
      "space_before_pt",
      "space_after_pt",
      "space_before_lines",
      "space_after_lines",
    ].includes(field) &&
    typeof value !== "number"
  ) {
    errors.push(`${path} 必须是数字。`);
  }
  if (
    ["bold", "italic", "underline", "keep_with_next", "keep_together"].includes(field) &&
    typeof value !== "boolean"
  ) {
    errors.push(`${path} 必须是布尔值。`);
  }
  if (
    field === "alignment" &&
    !["left", "center", "right", "justify"].includes(String(value))
  ) {
    errors.push(`${path} 只能是 left、center、right、justify。`);
  }
}

function validateCharacterFormatSchema(
  config: unknown,
  path: string,
  allowedScopes: Set<string>,
  errors: string[],
) {
  if (config === undefined) {
    return;
  }
  if (!isPlainObject(config)) {
    errors.push(`${path} 必须是对象。`);
    return;
  }
  for (const [field, value] of Object.entries(config)) {
    if (!["font", "size_pt", "size_cn", "scope"].includes(field)) {
      errors.push(`${path}.${field} 不在 schema 中。`);
      continue;
    }
    if ((field === "font" || field === "size_cn") && typeof value !== "string") {
      errors.push(`${path}.${field} 必须是字符串。`);
    }
    if (field === "size_pt" && typeof value !== "number") {
      errors.push(`${path}.size_pt 必须是数字。`);
    }
    if (field === "scope" && !allowedScopes.has(String(value))) {
      errors.push(`${path}.scope 不在允许范围内。`);
    }
  }
}

function validateTocSchema(toc: unknown, errors: string[]) {
  if (toc === undefined) {
    return;
  }
  if (!isPlainObject(toc)) {
    errors.push("toc 必须是对象。");
    return;
  }
  for (const field of Object.keys(toc)) {
    if (field !== "action") {
      errors.push(`toc.${field} 不在 schema 中。`);
    }
  }
  if (toc.action !== "protect") {
    errors.push("toc.action 只能是 protect。");
  }
}

function validateUnsupportedModulesSchema(
  unsupportedModules: unknown,
  errors: string[],
) {
  if (unsupportedModules === undefined) {
    return;
  }
  if (!isPlainObject(unsupportedModules)) {
    errors.push("unsupported_modules 必须是对象。");
    return;
  }
  for (const [moduleKey, config] of Object.entries(unsupportedModules)) {
    if (!UNSUPPORTED_MODULES.has(moduleKey)) {
      errors.push(`unsupported_modules.${moduleKey} 不在 schema 中。`);
      continue;
    }
    if (!isPlainObject(config)) {
      errors.push(`unsupported_modules.${moduleKey} 必须是对象。`);
      continue;
    }
    if (config.status !== "detected_but_not_supported") {
      errors.push(`unsupported_modules.${moduleKey}.status 必须是 detected_but_not_supported。`);
    }
    if (config.action !== "warning_only") {
      errors.push(`unsupported_modules.${moduleKey}.action 必须是 warning_only。`);
    }
    if (typeof config.note !== "string" || !config.note.trim()) {
      errors.push(`unsupported_modules.${moduleKey}.note 必须是非空字符串。`);
    }
    for (const field of Object.keys(config)) {
      if (!["status", "action", "note"].includes(field)) {
        errors.push(`unsupported_modules.${moduleKey}.${field} 不在 schema 中。`);
      }
    }
  }
}

function normalizeAiStyles(
  styles: unknown,
  warnings: string[],
  normalizedFields: string[],
  droppedFields: string[],
) {
  if (!isPlainObject(styles)) {
    return styles;
  }

  const normalizedStyles: Record<string, Record<string, unknown>> = {};
  for (const [target, config] of Object.entries(styles)) {
    if (!STYLE_TARGET_SET.has(target)) {
      droppedFields.push(`styles.${target}`);
      warnings.push(`AI 返回了当前 schema 不支持的样式目标 styles.${target}，已忽略。`);
      continue;
    }
    if (!isPlainObject(config)) {
      normalizedStyles[target] = config as Record<string, unknown>;
      continue;
    }

    const normalizedConfig: Record<string, unknown> = {};
    for (const [field, value] of Object.entries(config)) {
      const canonicalField = STYLE_FIELD_ALIASES[field] || field;
      if (field !== canonicalField) {
        normalizedFields.push(`styles.${target}.${field} -> styles.${target}.${canonicalField}`);
        warnings.push(
          `已将 AI 字段 styles.${target}.${field} 规范化为 styles.${target}.${canonicalField}。`,
        );
      }
      if (!STYLE_FIELDS.has(canonicalField)) {
        droppedFields.push(`styles.${target}.${field}`);
        warnings.push(`AI 返回了当前 schema 不支持的样式字段 styles.${target}.${field}，已忽略。`);
        continue;
      }
      normalizedConfig[canonicalField] = value;
    }
    normalizedStyles[target] = normalizedConfig;
  }

  return normalizedStyles;
}

function normalizeKnownObjectFields(
  value: unknown,
  path: string,
  allowedFields: Set<string>,
  warnings: string[],
  droppedFields: string[],
) {
  if (!isPlainObject(value)) {
    return value;
  }

  const normalized: Record<string, unknown> = {};
  for (const [field, fieldValue] of Object.entries(value)) {
    if (!allowedFields.has(field)) {
      droppedFields.push(`${path}.${field}`);
      warnings.push(`AI 返回了当前 schema 不支持的字段 ${path}.${field}，已忽略。`);
      continue;
    }
    normalized[field] = fieldValue;
  }
  return normalized;
}

function normalizeAiWarnings(value: unknown, warnings: string[]) {
  if (Array.isArray(value)) {
    return value.filter((warning): warning is string => typeof warning === "string");
  }
  if (typeof value === "string" && value.trim()) {
    warnings.push("AI 返回 warnings 为字符串，已规范化为字符串数组。");
    return [value.trim()];
  }
  warnings.push("AI 返回 warnings 不是字符串数组，已忽略该字段。");
  return [];
}

function normalizeAiUnsupportedModules(
  unsupportedModules: unknown,
  normalizedRules: Record<string, unknown>,
  requirementsText: string,
  warnings: string[],
  normalizedFields: string[],
  droppedFields: string[],
) {
  if (unsupportedModules === undefined) {
    return undefined;
  }
  if (!isPlainObject(unsupportedModules)) {
    droppedFields.push("unsupported_modules");
    warnings.push("AI 返回 unsupported_modules 不是对象，已忽略该字段。");
    return undefined;
  }

  const normalizedModules: Record<
    string,
    { status: string; action: string; note: string }
  > = {};

  for (const [moduleKey, config] of Object.entries(unsupportedModules)) {
    if (moduleKey === "hanging_indent") {
      droppedFields.push("unsupported_modules.hanging_indent");
      warnings.push(
        "AI 返回 unsupported_modules.hanging_indent；当前版本没有悬挂缩进执行字段，已作为提醒忽略，不阻断解析。",
      );
      continue;
    }

    if (moduleKey === "text_formatting") {
      droppedFields.push("unsupported_modules.text_formatting");
      normalizeTextFormattingModule(
        config,
        normalizedRules,
        requirementsText,
        warnings,
        normalizedFields,
      );
      continue;
    }

    const canonicalKey = UNSUPPORTED_MODULE_ALIASES[moduleKey] || moduleKey;
    if (canonicalKey !== moduleKey) {
      normalizedFields.push(`unsupported_modules.${moduleKey} -> unsupported_modules.${canonicalKey}`);
      warnings.push(
        `已将 AI 字段 unsupported_modules.${moduleKey} 规范化为 unsupported_modules.${canonicalKey}。`,
      );
    }

    if (!UNSUPPORTED_MODULES.has(canonicalKey)) {
      droppedFields.push(`unsupported_modules.${moduleKey}`);
      warnings.push(`AI 返回了当前 schema 不支持的模块 unsupported_modules.${moduleKey}，已忽略。`);
      continue;
    }

    normalizedModules[canonicalKey] = mergeUnsupportedModuleConfig(
      normalizedModules[canonicalKey],
      canonicalKey,
      config,
    );
  }

  return normalizedModules;
}

function mergeUnsupportedModuleConfig(
  existing:
    | { status: string; action: string; note: string }
    | undefined,
  moduleKey: string,
  rawConfig: unknown,
) {
  const next = toUnsupportedModuleConfig(moduleKey, rawConfig);
  if (!existing) {
    return next;
  }
  if (existing.note.includes(next.note)) {
    return existing;
  }
  return {
    ...existing,
    note: `${existing.note}；${next.note}`,
  };
}

function toUnsupportedModuleConfig(moduleKey: string, rawConfig: unknown) {
  const defaultNote = getDefaultUnsupportedModuleNote(moduleKey);
  if (isPlainObject(rawConfig)) {
    return {
      status:
        rawConfig.status === "detected_but_not_supported"
          ? "detected_but_not_supported"
          : "detected_but_not_supported",
      action: rawConfig.action === "warning_only" ? "warning_only" : "warning_only",
      note: typeof rawConfig.note === "string" && rawConfig.note.trim()
        ? rawConfig.note.trim()
        : defaultNote,
    };
  }
  if (typeof rawConfig === "string" && rawConfig.trim()) {
    return {
      status: "detected_but_not_supported",
      action: "warning_only",
      note: rawConfig.trim(),
    };
  }
  return {
    status: "detected_but_not_supported",
    action: "warning_only",
    note: defaultNote,
  };
}

function getDefaultUnsupportedModuleNote(moduleKey: string) {
  const notes: Record<string, string> = {
    header_footer: "检测到页眉页脚要求，但当前版本暂不处理。",
    page_number: "检测到页码要求，但当前版本暂不处理。",
    footnote: "检测到脚注要求，但当前版本暂不处理。",
    endnote: "检测到尾注要求，但当前版本暂不处理。",
    table_three_line: "检测到三线表要求，但当前版本暂不处理。",
    formula: "检测到公式要求，但当前版本暂不处理。",
    figure_caption: "检测到图题要求，但当前版本暂不处理。",
    table_caption: "检测到表题要求，但当前版本暂不处理。",
  };
  return notes[moduleKey] || `检测到 ${moduleKey} 要求，但当前版本暂不处理。`;
}

function normalizeTextFormattingModule(
  config: unknown,
  normalizedRules: Record<string, unknown>,
  requirementsText: string,
  warnings: string[],
  normalizedFields: string[],
) {
  const text = `${stringifyRecoverableConfig(config)} ${requirementsText}`;
  let recovered = false;

  if (/(黑色|black)/i.test(text) && /(全文|全部|正文|文字|字体|颜色|color)/i.test(text)) {
    ensureBodyStyle(normalizedRules).color = "000000";
    normalizedFields.push("unsupported_modules.text_formatting -> styles.body.color");
    warnings.push("已将 AI 的 text_formatting 颜色要求规范化为 styles.body.color=000000。");
    recovered = true;
  }

  if (/(清除|取消|去除|删除|无|没有).{0,12}(下划线|underline)/i.test(text)) {
    ensureBodyStyle(normalizedRules).underline = false;
    normalizedFields.push("unsupported_modules.text_formatting -> styles.body.underline");
    warnings.push("已将 AI 的 text_formatting 下划线要求规范化为 styles.body.underline=false。");
    recovered = true;
  }

  if (!recovered) {
    warnings.push(
      "AI 返回 unsupported_modules.text_formatting；未识别到可映射的颜色或下划线字段，已作为提醒忽略，不阻断解析。",
    );
  }
}

function ensureBodyStyle(normalizedRules: Record<string, unknown>) {
  if (!isPlainObject(normalizedRules.styles)) {
    normalizedRules.styles = {};
  }
  const styles = normalizedRules.styles as Record<string, unknown>;
  if (!isPlainObject(styles.body)) {
    styles.body = {};
  }
  return styles.body as Record<string, unknown>;
}

function stringifyRecoverableConfig(config: unknown) {
  if (typeof config === "string") {
    return config;
  }
  if (isPlainObject(config)) {
    return Object.values(config)
      .map((value) => (typeof value === "string" ? value : ""))
      .filter(Boolean)
      .join(" ");
  }
  return "";
}

function rememberConflictCandidate(
  seen: Map<string, { value: string; displayValue: string }>,
  conflicts: ConflictResult["conflicts"],
  warnings: string[],
  target: string,
  field: string,
  scope: string,
  rawValue: unknown,
  config?: Record<string, unknown>,
  sourceField?: string,
) {
  const normalizedValue = normalizeConflictValue(field, rawValue, config, sourceField);
  const displayValue = formatConflictValue(rawValue);
  const key = `${target}.${field}.${scope}`;
  const previous = seen.get(key);
  if (previous && previous.value !== normalizedValue) {
    const values = [previous.displayValue, displayValue];
    conflicts.push({ target, field, scope, values });
    warnings.push(
      `${target} ${field} 在 ${scope} 范围存在冲突：${values.join(" vs ")}。`,
    );
  }
  seen.set(key, { value: normalizedValue, displayValue });
}

function collectStyleMergeConflictWarnings(
  previousConfig: Record<string, unknown> | undefined,
  nextConfig: Record<string, unknown>,
  target: string,
  warnings: string[],
) {
  if (!previousConfig) {
    return;
  }
  for (const [field, value] of Object.entries(nextConfig)) {
    const conflictField = getConflictField(field);
    if (!conflictField) {
      continue;
    }
    const previousValue = previousConfig[field];
    if (previousValue === undefined) {
      continue;
    }
    if (
      normalizeConflictValue(conflictField, previousValue, previousConfig, field) !==
      normalizeConflictValue(conflictField, value, nextConfig, field)
    ) {
      warnings.push(
        `${getConflictStyleLabel(target)} ${conflictField} 存在冲突：${formatConflictValue(previousValue)} vs ${formatConflictValue(value)}，已暂按后者覆盖。`,
      );
    }
  }
}

function mockParseComplexRequirements(requirementsText: string): OverrideRules {
  const unsupportedModules = detectUnsupportedModules(requirementsText);
  const styles: NonNullable<OverrideRules["styles"]> = {};

  if (/摘要/.test(requirementsText)) {
    styles.abstract_cn_title = {
      font: "黑体",
      size_cn: "小四",
      bold: true,
      alignment: "center",
    };
    styles.abstract_cn_content = {
      font: "宋体",
      size_cn: "小四",
      line_spacing: 1.5,
      first_line_indent_chars: 2,
      alignment: "justify",
    };
  }
  if (/关键词|关键字/.test(requirementsText)) {
    styles.keywords_cn_label = {
      font: "黑体",
      size_cn: "小四",
      bold: true,
    };
    styles.keywords_cn_content = {
      font: "宋体",
      size_cn: "小四",
      bold: false,
    };
  }
  if (/英文摘要|Abstract/i.test(requirementsText)) {
    styles.abstract_en_title = {
      font: "Times New Roman",
      size_cn: "小四",
      bold: true,
      alignment: "center",
    };
    styles.abstract_en_content = {
      font: "Times New Roman",
      size_cn: "小四",
      line_spacing: 1.5,
      alignment: "justify",
      first_line_indent_chars: 0,
      bold: false,
    };
  }
  if (/Keywords|Key\s*words|英文关键词/i.test(requirementsText)) {
    styles.keywords_en_label = {
      font: "Times New Roman",
      size_cn: "小四",
      bold: true,
    };
    styles.keywords_en_content = {
      font: "Times New Roman",
      size_cn: "小四",
      bold: false,
    };
  }
  if (/正文/.test(requirementsText)) {
    styles.body = {
      font: "宋体",
      size_cn: "小四",
    };
  }
  if (/参考文献/.test(requirementsText)) {
    styles.reference_item = {
      font: "宋体",
      size_cn: /五号/.test(requirementsText) ? "五号" : "小四",
    };
  }

  return {
    name: "mock_ai_parsed_requirements",
    description: "本地 mock 复杂解析结果，仅用于开发测试",
    styles,
    ...(hasExplicitLatinDigitTarget(requirementsText)
      ? {
          latin_digit_format: {
            font: "Times New Roman",
            size_cn: /五号/.test(requirementsText) && !/正文/.test(requirementsText) ? "五号" : "小四",
            scope: /正文/.test(requirementsText) ? "body" : "global",
          },
        }
      : {}),
    ...(shouldAddReferenceLatinDigitFormat(requirementsText)
      ? {
          reference_latin_digit_format: {
            font: "Times New Roman",
            size_cn: "五号",
            scope: "reference",
          },
        }
      : {}),
    ...(requirementsText.includes("目录") ? { toc: { action: "protect" } } : {}),
    ...(Object.keys(unsupportedModules).length ? { unsupported_modules: unsupportedModules } : {}),
    warnings: [
      "当前为 mock 解析结果，仅用于本地开发测试。正式使用请配置 KIMI_API_KEY。",
    ],
  };
}

function shouldAddReferenceLatinDigitFormat(requirementsText: string) {
  return /参考文献.{0,40}(英文|英文字母|数字|年份|页码|卷期号|期刊名).{0,80}Times\s*New\s*Roman/i.test(
    requirementsText,
  );
}

function detectUnsupportedModules(requirementsText: string) {
  const modules: Record<string, { status: string; action: string; note: string }> = {};
  const add = (key: string, note: string) => {
    modules[key] = {
      status: "detected_but_not_supported",
      action: "warning_only",
      note,
    };
  };
  if (/页眉|页脚/.test(requirementsText)) {
    add("header_footer", "检测到页眉页脚要求，但当前版本暂不处理。");
  }
  if (/页码|页数/.test(requirementsText)) {
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
  return modules;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parsePositiveIntegerEnv(value: string | undefined, fallback: number) {
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function normalizeKimiApiError(error: unknown): KimiApiError {
  if (error instanceof KimiApiError) {
    return error;
  }
  if (!(error instanceof Error)) {
    return new KimiApiError("api_network_error", "Kimi API 请求失败：未知错误。");
  }

  const status = getErrorStatus(error);
  const message = error.message || "Kimi API 请求失败。";
  const lowerMessage = message.toLowerCase();
  if (status === 401 || status === 403) {
    return new KimiApiError(
      "api_auth_failed",
      "Kimi API 鉴权失败，请检查 KIMI_API_KEY 是否正确或是否有可用额度。",
      status,
    );
  }
  if (
    status === 400 ||
    status === 404 ||
    lowerMessage.includes("model") ||
    lowerMessage.includes("invalid_request")
  ) {
    return new KimiApiError(
      "api_model_or_request_error",
      `Kimi API 请求参数或模型名可能不正确：${message}`,
      status,
    );
  }
  return new KimiApiError(
    "api_network_error",
    `Kimi API 网络请求失败：${message}`,
    status,
  );
}

function getErrorStatus(error: Error) {
  const maybeStatus = (error as { status?: unknown }).status;
  return typeof maybeStatus === "number" ? maybeStatus : undefined;
}

function parsePageConfig(text: string) {
  const page: Record<string, number> = {};
  const compactText = text.replace(/\s+/g, "");
  const hasPageContext = /页边距|边距/.test(compactText);
  const marginPattern =
    /(左页边距|左边距|右页边距|右边距|上页边距|上边距|下页边距|下边距)[：:=为设设置]*(\d+(?:\.\d+)?)(?:cm|厘米|公分)?/g;

  for (const match of compactText.matchAll(marginPattern)) {
    const value = Number(match[2]);
    if (!Number.isFinite(value)) {
      continue;
    }

    applyMarginValue(page, match[1], value);
  }

  if (hasPageContext) {
    const compactMarginPattern =
      /(上下左右|上下|左右|上|下|左|右)(?:边距)?(?:均为|均|为|[:：=])?(\d+(?:\.\d+)?)(?:cm|厘米|公分)/g;
    for (const match of compactText.matchAll(compactMarginPattern)) {
      const value = Number(match[2]);
      if (!Number.isFinite(value)) {
        continue;
      }

      applyMarginValue(page, match[1], value);
    }

    const restMatch = compactText.match(/其余(?:均为|为|[:：=])?(\d+(?:\.\d+)?)(?:cm|厘米|公分)/);
    if (restMatch) {
      const restValue = Number(restMatch[1]);
      if (Number.isFinite(restValue)) {
        fillMissingMargins(page, restValue);
      }
    }
  }

  return page;
}

function applyMarginValue(page: Record<string, number>, label: string, value: number) {
  if (label.includes("上下左右")) {
    page.top_margin_cm = value;
    page.bottom_margin_cm = value;
    page.left_margin_cm = value;
    page.right_margin_cm = value;
    return;
  }

  if (label.includes("上下")) {
    page.top_margin_cm = value;
    page.bottom_margin_cm = value;
    return;
  }

  if (label.includes("左右")) {
    page.left_margin_cm = value;
    page.right_margin_cm = value;
    return;
  }

  if (label.startsWith("左")) {
    page.left_margin_cm = value;
  } else if (label.startsWith("右")) {
    page.right_margin_cm = value;
  } else if (label.startsWith("上")) {
    page.top_margin_cm = value;
  } else if (label.startsWith("下")) {
    page.bottom_margin_cm = value;
  }
}

function fillMissingMargins(page: Record<string, number>, value: number) {
  page.top_margin_cm ??= value;
  page.bottom_margin_cm ??= value;
  page.left_margin_cm ??= value;
  page.right_margin_cm ??= value;
}

function parseLatinDigitFormat(requirementsText: string) {
  const clauses = requirementsText
    .split(/[；;。\n\r]+/)
    .map((clause) => clause.trim())
    .filter(Boolean);

  let parsed: Record<string, unknown> | null = null;
  for (const clause of clauses) {
    if (!hasExplicitLatinDigitTarget(clause)) {
      continue;
    }

    const font = parseFont(clause);
    const sizeCn = parseChineseSize(clause);
    if (!font && !sizeCn) {
      continue;
    }

    const format: Record<string, unknown> = {
      ...(parsed || {}),
      ...(font ? { font } : {}),
      ...(sizeCn ? { size_cn: sizeCn } : {}),
      scope: /正文/.test(clause) && !/全文/.test(clause) ? "body" : "global",
    };
    parsed = format;
  }

  return parsed;
}

function hasExplicitLatinDigitTarget(clause: string) {
  if (/(摘要|Abstract|关键词|Keywords|Key\s*words)/i.test(clause) && !/(全文|正文)/.test(clause)) {
    return false;
  }

  const compactClause = clause.replace(/\s+/g, "");
  const hasLatin = /(英文(?:字母|字符)?|英文字母|拉丁字母)/.test(compactClause);
  const hasDigit = /(阿拉伯数字|数字)/.test(compactClause);
  return hasLatin && hasDigit;
}

function isLatinDigitOnlyClause(clause: string) {
  return hasExplicitLatinDigitTarget(clause);
}

function detectStyleTargets(clause: string) {
  if (isLatinDigitOnlyClause(clause)) {
    return [];
  }

  const targets: string[] = [];
  const hasEnglishAbstract = /英文摘要|Abstract/i.test(clause);
  const hasEnglishKeywords = /英文关键词|英文关键字|Keywords|Key\s*words/i.test(clause);

  if (/论文标题|文章标题|题目/.test(clause)) {
    targets.push("paper_title");
  }
  if (/正文/.test(clause)) {
    targets.push("body");
  }
  if (isGenericChineseBodyStyleClause(clause)) {
    targets.push("body");
  }
  if (/一级标题|一[级級]标题/.test(clause)) {
    targets.push("heading_1");
  }
  if (/二级标题|二[级級]标题/.test(clause)) {
    targets.push("heading_2");
  }
  if (/三级标题|三[级級]标题/.test(clause)) {
    targets.push("heading_3");
  }
  if (hasEnglishAbstract) {
    targets.push("abstract_en_title");
    targets.push("abstract_en_content");
  } else if (/摘要/.test(clause)) {
    targets.push("abstract_content");
  }
  if (hasEnglishKeywords) {
    targets.push("keywords_en");
  } else if (/关键词/.test(clause)) {
    targets.push("keywords");
  }
  if (/图题/.test(clause)) {
    targets.push("figure_caption");
  }
  if (/表题/.test(clause)) {
    targets.push("table_caption");
  }
  if (/参考文献\s*(标题|题名)/.test(clause)) {
    targets.push("reference_title");
  }
  if (/参考文献\s*(条目|正文|内容|列表)|文献条目|^条目/.test(clause)) {
    targets.push("reference_item");
  } else if (/参考文献(?!\s*(标题|题名))/.test(clause)) {
    targets.push("reference_item");
  }

  return Array.from(new Set(targets));
}

function parseStyleConfig(clause: string): Record<string, unknown> {
  if (isLatinDigitOnlyClause(clause)) {
    return {};
  }

  const config: Record<string, unknown> = {};
  const font = parseFont(clause);
  const sizeCn = parseChineseSize(clause);
  const lineSpacing = parseLineSpacing(clause);
  const indent = parseFirstLineIndent(clause);
  const alignment = parseAlignment(clause);

  if (font) {
    config.font = font;
  }
  if (sizeCn) {
    config.size_cn = sizeCn;
  }
  if (typeof lineSpacing === "number") {
    config.line_spacing = lineSpacing;
  }
  if (indent !== null) {
    if (typeof indent === "string") {
      const charMatch = indent.match(/^(\d+(?:\.\d+)?)字符$/);
      if (charMatch) {
        config.first_line_indent_chars = Number(charMatch[1]);
      } else {
        config.first_line_indent_pt = indent;
      }
    } else {
      config.first_line_indent_pt = indent;
    }
  }
  if (alignment) {
    config.alignment = alignment;
  }
  if (/加粗/.test(clause)) {
    config.bold = true;
  }
  if (/不加粗|取消加粗/.test(clause)) {
    config.bold = false;
  }
  if (
    /(取消|清除|去除|去掉|删除|移除|不加|不要|无).{0,16}下划线|下划线.{0,16}(取消|清除|去除|去掉|删除|移除)/.test(
      clause,
    )
  ) {
    config.underline = false;
  } else if (/(添加|增加|加上|使用|设置|采用).{0,8}下划线|加下划线/.test(clause)) {
    config.underline = true;
  }

  return config;
}

function isGenericChineseBodyStyleClause(clause: string) {
  const compactClause = clause.replace(/\s+/g, "");
  return (
    /^中文/.test(compactClause) &&
    !/(摘要|关键词|关键字|标题|题目|参考文献|图题|表题|目录)/.test(compactClause)
  );
}

const CONFLICT_FIELDS = new Set([
  "font",
  "size",
  "alignment",
  "line_spacing",
  "first_line_indent_pt",
  "bold",
  "underline",
]);

const CONFLICT_STYLE_LABELS: Record<string, string> = {
  paper_title: "论文标题",
  abstract_cn_title: "中文摘要标题",
  abstract_cn_content: "中文摘要正文",
  keywords_cn_label: "中文关键词标签",
  keywords_cn_content: "中文关键词内容",
  abstract_title: "摘要标题",
  abstract_content: "摘要正文",
  keywords: "关键词",
  abstract_en_title: "英文摘要标题",
  abstract_en_content: "英文摘要正文",
  keywords_en: "英文关键词",
  keywords_en_label: "英文关键词标签",
  keywords_en_content: "英文关键词内容",
  heading_1: "一级标题",
  heading_2: "二级标题",
  heading_3: "三级标题",
  body: "正文",
  table_caption: "表题",
  figure_caption: "图题",
  reference_title: "参考文献标题",
  reference_item: "参考文献条目",
  table_text: "表格文字",
};

const CHINESE_SIZE_TO_PT: Record<string, number> = {
  初号: 42,
  小初: 36,
  一号: 26,
  小一: 24,
  二号: 22,
  小二: 18,
  三号: 16,
  小三: 15,
  四号: 14,
  小四: 12,
  五号: 10.5,
  小五: 9,
  六号: 7.5,
  小六: 6.5,
  七号: 5.5,
  八号: 5,
};

function getConflictField(field: string) {
  const normalizedField =
    field === "size_cn" || field === "size_pt"
      ? "size"
      : field === "first_line_indent_chars"
        ? "first_line_indent_pt"
        : field;
  return CONFLICT_FIELDS.has(normalizedField) ? normalizedField : "";
}

function getConflictStyleSizePt(config?: Record<string, unknown>) {
  if (!config) {
    return 12;
  }
  if (typeof config.size_pt === "number") {
    return config.size_pt;
  }
  if (typeof config.size_cn === "string" && CHINESE_SIZE_TO_PT[config.size_cn]) {
    return CHINESE_SIZE_TO_PT[config.size_cn];
  }
  return 12;
}

function normalizeConflictValue(
  field: string,
  value: unknown,
  config?: Record<string, unknown>,
  sourceField?: string,
) {
  if (
    field === "first_line_indent_pt" &&
    sourceField === "first_line_indent_chars" &&
    typeof value === "number"
  ) {
    return `${field}:${Number((value * getConflictStyleSizePt(config)).toFixed(3))}`;
  }
  if (typeof value === "number") {
    return `${field}:${value}`;
  }
  if (typeof value === "boolean") {
    return `${field}:${value ? "true" : "false"}`;
  }
  return `${field}:${String(value).trim().toLowerCase()}`;
}

function formatConflictValue(value: unknown) {
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  return String(value);
}

function getConflictStyleLabel(styleName: string) {
  return CONFLICT_STYLE_LABELS[styleName] || styleName;
}

function parseFont(clause: string) {
  const fonts = ["Times New Roman", "微软雅黑", "Microsoft YaHei", "宋体", "黑体", "楷体", "仿宋"];
  return fonts.find((font) => clause.includes(font)) || "";
}

function parseChineseSize(clause: string) {
  const sizes = [
    "小初",
    "初号",
    "小一",
    "一号",
    "小二",
    "二号",
    "小三",
    "三号",
    "小四",
    "四号",
    "小五",
    "五号",
    "小六",
    "六号",
    "七号",
    "八号",
  ];
  return sizes.find((size) => clause.includes(size)) || "";
}

function parseLineSpacing(clause: string) {
  if (/单倍行距|单倍/.test(clause)) {
    return 1.0;
  }
  if (/双倍行距|双倍/.test(clause)) {
    return 2.0;
  }

  const match = clause.match(/(\d+(?:\.\d+)?)\s*倍/);
  if (!match) {
    return null;
  }

  return Number(match[1]);
}

function parseFirstLineIndent(clause: string) {
  if (/不缩进|无缩进|首行缩进\s*0/.test(clause)) {
    return 0;
  }

  if (/首行缩进\s*两个字符|首行缩进\s*2\s*(字符|字)/.test(clause)) {
    return "2字符";
  }

  const match = clause.match(/首行缩进\s*(\d+(?:\.\d+)?)\s*(字符|字)/);
  if (!match) {
    return null;
  }

  return `${match[1]}字符`;
}

function parseAlignment(clause: string) {
  if (/居中|居中对齐/.test(clause)) {
    return "center";
  }
  if (/两端对齐|分散对齐/.test(clause)) {
    return "justify";
  }
  if (/右对齐/.test(clause)) {
    return "right";
  }
  if (/左对齐/.test(clause)) {
    return "left";
  }

  return "";
}

const ALIGNMENT_WORDS = ["居中", "左对齐", "右对齐", "两端对齐", "分散对齐", "对齐"];
const LINE_SPACING_WORDS = ["行距", "单倍", "1.5倍", "一点五倍", "双倍"];

function hasNearbyRequirement(text: string, anchors: string[], words: string[]) {
  const compactText = text.replace(/\s+/g, "");
  for (const anchor of anchors) {
    let index = compactText.indexOf(anchor);
    while (index !== -1) {
      const windowText = compactText.slice(
        Math.max(0, index - 20),
        Math.min(compactText.length, index + anchor.length + 30),
      );
      if (words.some((word) => windowText.includes(word))) {
        return true;
      }
      index = compactText.indexOf(anchor, index + anchor.length);
    }
  }

  return false;
}

function hasAnyBoldTrue(styles: Record<string, unknown>) {
  return Object.values(styles).some(
    (style) => isPlainObject(style) && style.bold === true,
  );
}

function isAbortLikeError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }
  return (
    error.name === "AbortError" ||
    error.name === "APIConnectionTimeoutError" ||
    error.message.toLowerCase().includes("timeout") ||
    error.message.toLowerCase().includes("timed out") ||
    error.message.includes("aborted")
  );
}
