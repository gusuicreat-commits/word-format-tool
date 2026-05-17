import OpenAI from "openai";

import type { OverrideRules } from "./requirements";

const DEFAULT_KIMI_BASE_URL = "https://api.moonshot.ai/v1";
const MAX_MODEL_RESPONSE_LENGTH = 100_000;
const KIMI_REQUEST_TIMEOUT_MS = 45_000;

export function buildRequirementsPrompt(requirementsText: string) {
  const system = [
    "你是论文格式要求解析器，只能把自然语言格式要求转成 override JSON。",
    "不要读取或修改 Word，不要生成代码、命令、Markdown 或解释文字。",
    "只输出一个 JSON 对象。",
    "顶层字段只能使用 name、description、page、styles、warnings。",
    "page 字段只能使用 top_margin_cm、bottom_margin_cm、left_margin_cm、right_margin_cm，单位为 cm 的数字。例如左页边距 3cm 输出 page.left_margin_cm=3。",
    "styles 类型只能使用 paper_title、abstract_title、abstract_content、keywords、heading_1、heading_2、heading_3、body、table_caption、figure_caption、reference_title、reference_item、table_text。",
    "样式字段只能使用 font、size_pt、size_cn、bold、italic、alignment、line_spacing、first_line_indent_pt、space_before_pt、space_after_pt。",
    "alignment 只能是 left、center、right、justify；居中=center，两端对齐=justify。",
    "中文字号可用：初号、小初、一号、小一、二号、小二、三号、小三、四号、小四、五号、小五、六号、小六、七号、八号。",
    "严格忠于原文。老师明确写了什么，就只输出什么。",
    "不要自动补全常见论文格式。标题常见居中或加粗，也不能在原文没写时输出 alignment 或 bold。",
    "不要跨类别扩展要求。图题和表题的要求不能扩展到参考文献、正文或标题。",
    "参考文献标题只能作用于 reference_title；参考文献条目、文献列表或未说明“标题”的参考文献要求作用于 reference_item。",
    "reference_title 的居中、加粗等设置不能复制到 reference_item，除非原文明确写参考文献条目也居中或加粗。",
    "正文要求只作用于 body；除非原文明确写“全文统一”“摘要和正文一致”，不要扩展到摘要、关键词或参考文献。",
    "遇到“按学校要求”“排版规范”“标题清晰”等模糊要求，不要写入 styles，可以写入 warnings。",
    "正例：输入“一级标题黑体小三。”，只输出 heading_1.font=黑体 和 heading_1.size_cn=小三；不要输出居中、加粗或行距。",
    "正例：输入“图题和表题宋体五号居中，参考文献宋体五号。”，居中只作用于 figure_caption 和 table_caption，不能作用于 reference_item。",
    "正例：输入“左页边距 3cm，参考文献标题居中，参考文献条目宋体五号。”，输出 page.left_margin_cm=3、reference_title.alignment=center、reference_item.font=宋体、reference_item.size_cn=五号；reference_item 不输出 alignment。",
    "正例：输入“论文标题黑体三号居中。”，输出 font、size_cn、alignment；不要自动补 bold，除非原文写了加粗。",
    "错误例：原文只说“一级标题黑体小三”，却输出 alignment=center 或 bold=true。",
    "错误例：原文只说“参考文献宋体五号”，却输出 alignment、line_spacing 或 first_line_indent_pt。",
  ].join("\n");

  const user = [
    "解析下面要求为 override JSON：",
    "",
    requirementsText,
    "",
    JSON.stringify(
      {
        name: "ai_parsed_requirements",
        description: "由 Kimi 解析老师格式要求生成",
        styles: {
          body: {
            font: "宋体",
            size_cn: "小四",
            line_spacing: 1.5,
            first_line_indent_pt: "2字符",
          },
          heading_1: {
            font: "黑体",
            size_cn: "小三",
          },
        },
        warnings: [],
      },
    ),
  ].join("\n");

  return { system, user };
}

export async function callKimiForRequirements(requirementsText: string) {
  const apiKey = process.env.KIMI_API_KEY;
  const model = process.env.KIMI_MODEL;

  if (!apiKey) {
    throw new Error("错误：未配置 KIMI_API_KEY，请在 web/.env.local 中配置 Kimi API Key。");
  }

  if (!model) {
    throw new Error("错误：未配置 KIMI_MODEL，请在 web/.env.local 中设置模型名。");
  }

  const client = new OpenAI({
    apiKey,
    baseURL: process.env.KIMI_BASE_URL || DEFAULT_KIMI_BASE_URL,
    timeout: KIMI_REQUEST_TIMEOUT_MS,
  });
  const prompt = buildRequirementsPrompt(requirementsText);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), KIMI_REQUEST_TIMEOUT_MS);

  let completion;
  try {
    completion = await client.chat.completions.create(
      {
        model,
        messages: [
          { role: "system", content: prompt.system },
          { role: "user", content: prompt.user },
        ],
        max_tokens: 700,
      },
      {
        signal: controller.signal,
        timeout: KIMI_REQUEST_TIMEOUT_MS,
      },
    );
  } catch (error) {
    if (isAbortLikeError(error)) {
      throw new Error("错误：Kimi API 请求超时，请检查网络、模型名或稍后重试。");
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }

  const content = completion.choices[0]?.message?.content;
  if (!content || !content.trim()) {
    throw new Error("错误：Kimi 返回内容为空，请调整格式要求后重试。");
  }

  if (content.length > MAX_MODEL_RESPONSE_LENGTH) {
    throw new Error("错误：Kimi 返回内容过长，请精简格式要求后重试。");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJsonFromModelResponse(content));
  } catch {
    throw new Error("错误：Kimi 返回内容不是合法 JSON，请调整格式要求后重试。");
  }

  if (!isPlainObject(parsed)) {
    throw new Error("错误：Kimi 返回内容必须是 JSON 对象。");
  }

  return {
    rawModelOutput: content,
    parsedOverride: parsed as OverrideRules,
  };
}

export function mockParseRequirements(requirementsText: string): OverrideRules {
  const compactText = requirementsText.replace(/\s+/g, "");
  const page = parsePageConfig(requirementsText);
  const styles: NonNullable<OverrideRules["styles"]> = {};

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
      styles.body.first_line_indent_pt = "2字符";
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

  if (Object.keys(styles).length === 0 && Object.keys(page).length === 0) {
    styles.body = {
      font: "宋体",
      size_cn: "小四",
    };
  }

  return {
    name: "mock_ai_parsed_requirements",
    description: "本地 mock 解析结果，仅用于开发测试",
    ...(Object.keys(page).length > 0 ? { page } : {}),
    styles,
    warnings: [
      "当前为 mock 解析结果，仅用于本地开发测试。正式使用请配置 KIMI_API_KEY。",
    ],
  };
}

export function tryParseRequirementsLocally(requirementsText: string): OverrideRules | null {
  const page: NonNullable<OverrideRules["page"]> = parsePageConfig(requirementsText);
  const styles: NonNullable<OverrideRules["styles"]> = {};
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
        styles[target] = {
          ...(styles[target] || {}),
          ...styleConfig,
        };
      }
    }
  }

  if (Object.keys(styles).length === 0 && Object.keys(page).length === 0) {
    return null;
  }

  return {
    name: "local_parsed_requirements",
    description: "本地规则快速解析结果",
    ...(Object.keys(page).length > 0 ? { page } : {}),
    ...(Object.keys(styles).length > 0 ? { styles } : {}),
    warnings: ["已使用本地快速解析，复杂或含糊要求仍建议人工确认。"],
  };
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

function detectStyleTargets(clause: string) {
  const targets: string[] = [];

  if (/论文标题|文章标题|题目/.test(clause)) {
    targets.push("paper_title");
  }
  if (/正文/.test(clause)) {
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
  if (/摘要/.test(clause)) {
    targets.push("abstract_content");
  }
  if (/关键词/.test(clause)) {
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
    config.first_line_indent_pt = indent;
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

  return config;
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
