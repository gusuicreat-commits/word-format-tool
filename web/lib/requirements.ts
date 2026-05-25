export type OverrideRules = {
  name?: string;
  description?: string;
  page?: Record<string, unknown>;
  styles?: Record<string, Record<string, unknown>>;
  latin_digit_format?: Record<string, unknown>;
  reference_latin_digit_format?: Record<string, unknown>;
  toc?: Record<string, unknown>;
  unsupported_modules?: Record<string, Record<string, unknown>>;
  parser_metadata?: Record<string, unknown>;
  warnings?: unknown;
};

export type RuleSummaryItem = {
  type: string;
  label: string;
  description: string;
  fields: RuleFieldItem[];
};

export type RuleFieldItem = {
  key: string;
  label: string;
  value: string;
};

const STYLE_LABELS: Record<string, string> = {
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
  reference_item: "参考文献",
  table_text: "表格文字",
};

const STYLE_ORDER = [
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
  "keywords_en_label",
  "keywords_en_content",
  "keywords_en",
  "heading_1",
  "heading_2",
  "heading_3",
  "body",
  "table_caption",
  "figure_caption",
  "reference_title",
  "reference_item",
  "table_text",
];

const SUPPORTED_STYLE_TYPES = new Set(STYLE_ORDER);

const ALIGNMENT_LABELS: Record<string, string> = {
  left: "左对齐",
  center: "居中",
  right: "右对齐",
  justify: "两端对齐",
};

const SCOPE_LABELS: Record<string, string> = {
  global: "全文普通内容",
  body: "正文",
  abstract: "摘要",
  heading: "标题",
  reference: "参考文献",
};

const UNSUPPORTED_MODULE_LABELS: Record<string, string> = {
  header_footer: "页眉页脚",
  page_number: "页码",
  footnote: "脚注",
  endnote: "尾注",
  table_three_line: "三线表",
  formula: "公式",
  figure_caption: "图题",
  table_caption: "表题",
};

const FIELD_LABELS: Record<string, string> = {
  font: "字体",
  color: "颜色",
  size_cn: "字号",
  size_pt: "字号",
  bold: "加粗",
  italic: "斜体",
  underline: "下划线",
  alignment: "对齐方式",
  line_spacing: "行距",
  first_line_indent_pt: "首行缩进",
  first_line_indent_chars: "首行缩进",
  hanging_indent_chars: "悬挂缩进",
  space_before_pt: "段前",
  space_after_pt: "段后",
  space_before_lines: "段前",
  space_after_lines: "段后",
  scope: "作用范围",
  action: "处理方式",
  status: "状态",
  note: "说明",
};

export function summarizeOverrideRules(override: unknown): {
  items: RuleSummaryItem[];
  warnings: string[];
} {
  if (!isPlainObject(override)) {
    return { items: [], warnings: [] };
  }

  const rules = override as OverrideRules;
  const styles = isPlainObject(rules.styles) ? rules.styles : {};
  const styleNames = Object.keys(styles).sort(
    (a, b) => getStyleOrder(a) - getStyleOrder(b),
  );

  const items = styleNames
    .map((styleName) => {
      const config = styles[styleName];
      if (!isPlainObject(config)) {
        return null;
      }

      return {
        type: styleName,
        label: STYLE_LABELS[styleName] || styleName,
        description: describeStyle(config),
        fields: describeStyleFields(config),
      };
    })
    .filter((item): item is RuleSummaryItem => Boolean(item));

  if (isPlainObject(rules.latin_digit_format)) {
    items.push({
      type: "latin_digit_format",
      label: "英文和数字",
      description: describeLatinDigitFormat(rules.latin_digit_format),
      fields: describeLatinDigitFormatFields(rules.latin_digit_format),
    });
  }

  if (isPlainObject(rules.reference_latin_digit_format)) {
    items.push({
      type: "reference_latin_digit_format",
      label: "参考文献英文和数字",
      description: describeLatinDigitFormat(rules.reference_latin_digit_format),
      fields: describeLatinDigitFormatFields(rules.reference_latin_digit_format),
    });
  }

  if (isPlainObject(rules.toc)) {
    items.push({
      type: "toc",
      label: "目录",
      description: rules.toc.action === "protect" ? "保护，不生成，不更新" : "已识别目录要求",
      fields: describeGenericFields(rules.toc),
    });
  }

  if (isPlainObject(rules.unsupported_modules)) {
    for (const [moduleKey, moduleConfig] of Object.entries(rules.unsupported_modules)) {
      if (!isPlainObject(moduleConfig)) {
        continue;
      }
      items.push({
        type: `unsupported_modules.${moduleKey}`,
        label: UNSUPPORTED_MODULE_LABELS[moduleKey] || moduleKey,
        description: describeUnsupportedModule(moduleConfig),
        fields: describeGenericFields(moduleConfig),
      });
    }
  }

  if (isPlainObject(rules.page)) {
    const pageParts = [
      formatNumberField(rules.page.top_margin_cm, "上边距", "cm"),
      formatNumberField(rules.page.bottom_margin_cm, "下边距", "cm"),
      formatNumberField(rules.page.left_margin_cm, "左边距", "cm"),
      formatNumberField(rules.page.right_margin_cm, "右边距", "cm"),
    ].filter(Boolean);

    if (pageParts.length > 0) {
      items.unshift({
        type: "page",
        label: "页面边距",
        description: pageParts.join("，"),
        fields: describePageFields(rules.page),
      });
    }
  }

  const warnings = Array.isArray(rules.warnings)
    ? rules.warnings.filter((warning): warning is string => typeof warning === "string")
    : [];

  return { items, warnings };
}

export function collectOverrideFields(override: unknown): string[] {
  if (!isPlainObject(override)) {
    return [];
  }

  const fields: string[] = [];
  const rules = override as OverrideRules;

  if (isPlainObject(rules.page)) {
    for (const field of Object.keys(rules.page)) {
      if (!field.startsWith("_")) {
        fields.push(`page.${field}`);
      }
    }
  }

  if (isPlainObject(rules.styles)) {
    for (const [styleName, styleConfig] of Object.entries(rules.styles)) {
      if (!SUPPORTED_STYLE_TYPES.has(styleName) || !isPlainObject(styleConfig)) {
        continue;
      }

      for (const field of Object.keys(styleConfig)) {
        if (field.startsWith("_")) {
          continue;
        }

        if (field === "size_cn") {
          if (!Object.prototype.hasOwnProperty.call(styleConfig, "size_pt")) {
            fields.push(`styles.${styleName}.size_pt`);
          }
          continue;
        }

        fields.push(`styles.${styleName}.${field}`);
      }
    }
  }

  collectCharacterFormatFields(rules.latin_digit_format, "latin_digit_format", fields);
  collectCharacterFormatFields(
    rules.reference_latin_digit_format,
    "reference_latin_digit_format",
    fields,
  );

  if (isPlainObject(rules.toc)) {
    for (const field of Object.keys(rules.toc)) {
      if (!field.startsWith("_")) {
        fields.push(`toc.${field}`);
      }
    }
  }

  if (isPlainObject(rules.unsupported_modules)) {
    for (const [moduleKey, moduleConfig] of Object.entries(rules.unsupported_modules)) {
      if (!isPlainObject(moduleConfig)) {
        continue;
      }
      for (const field of Object.keys(moduleConfig)) {
        if (!field.startsWith("_")) {
          fields.push(`unsupported_modules.${moduleKey}.${field}`);
        }
      }
    }
  }

  return Array.from(new Set(fields));
}

export function getFinalRulesPreview(finalRules: unknown) {
  if (!isPlainObject(finalRules)) {
    return {};
  }

  const preview: Record<string, unknown> = {};
  const styles = isPlainObject(finalRules.styles) ? finalRules.styles : {};
  for (const styleName of STYLE_ORDER) {
    if (styles[styleName]) {
      preview[styleName] = styles[styleName];
    }
  }

  if (isPlainObject(finalRules.page)) {
    preview.page = finalRules.page;
  }
  if (isPlainObject(finalRules.latin_digit_format)) {
    preview.latin_digit_format = finalRules.latin_digit_format;
  }
  if (isPlainObject(finalRules.reference_latin_digit_format)) {
    preview.reference_latin_digit_format = finalRules.reference_latin_digit_format;
  }
  if (isPlainObject(finalRules.toc)) {
    preview.toc = finalRules.toc;
  }
  if (isPlainObject(finalRules.unsupported_modules)) {
    preview.unsupported_modules = finalRules.unsupported_modules;
  }

  return preview;
}

function collectCharacterFormatFields(
  format: unknown,
  prefix: string,
  fields: string[],
) {
  if (!isPlainObject(format)) {
    return;
  }
  for (const field of Object.keys(format)) {
    if (field.startsWith("_")) {
      continue;
    }
    if (field === "size_cn") {
      if (!Object.prototype.hasOwnProperty.call(format, "size_pt")) {
        fields.push(`${prefix}.size_pt`);
      }
      continue;
    }
    fields.push(`${prefix}.${field}`);
  }
}

function describeLatinDigitFormat(format: Record<string, unknown>) {
  const parts = [
    typeof format.font === "string" ? format.font : "",
    typeof format.size_cn === "string"
      ? format.size_cn
      : typeof format.size_pt === "number"
        ? `${format.size_pt} 磅`
        : "",
    typeof format.scope === "string" ? SCOPE_LABELS[format.scope] || format.scope : "",
  ].filter(Boolean);
  return parts.length > 0 ? parts.join("，") : "已识别英文/数字字符格式";
}

function describeLatinDigitFormatFields(format: Record<string, unknown>) {
  return Object.entries(format)
    .filter(([key]) => !key.startsWith("_"))
    .map(([key, value]) => {
      if (key === "size_pt" && typeof format.size_cn === "string") {
        return null;
      }
      return {
        key,
        label: FIELD_LABELS[key] || key,
        value: formatFieldValue(key, value),
      };
    })
    .filter((item): item is RuleFieldItem => item !== null && item.value !== "");
}

function describeUnsupportedModule(moduleConfig: Record<string, unknown>) {
  const note = typeof moduleConfig.note === "string" ? moduleConfig.note : "";
  return note || "检测到但当前版本暂不支持，仅提醒";
}

function describeStyle(style: Record<string, unknown>) {
  const parts = [
    typeof style.font === "string" ? style.font : "",
    typeof style.size_cn === "string"
      ? style.size_cn
      : typeof style.size_pt === "number"
        ? `${style.size_pt} 磅`
        : "",
    style.bold === true ? "加粗" : "",
    style.bold === false ? "不加粗" : "",
    style.italic === true ? "斜体" : "",
    formatAlignment(style.alignment),
    formatColor(style.color),
    formatLineSpacing(style.line_spacing),
    formatIndent(style.first_line_indent_chars, "chars"),
    formatIndent(style.first_line_indent_pt, "pt"),
    formatNumberField(style.space_before_pt, "段前", "磅"),
    formatNumberField(style.space_after_pt, "段后", "磅"),
  ].filter(Boolean);

  return parts.length > 0 ? parts.join("，") : "已识别自定义规则";
}

function describeStyleFields(style: Record<string, unknown>) {
  return Object.entries(style)
    .filter(([key]) => !key.startsWith("_"))
    .map(([key, value]) => {
      if (key === "size_pt" && typeof style.size_cn === "string") {
        return null;
      }

      return {
        key,
        label: FIELD_LABELS[key] || key,
        value: formatFieldValue(key, value),
      };
    })
    .filter(
      (item): item is RuleFieldItem =>
        item !== null && item.value !== "",
    );
}

function describeGenericFields(config: Record<string, unknown>) {
  return Object.entries(config)
    .filter(([key]) => !key.startsWith("_"))
    .map(([key, value]) => ({
      key,
      label: FIELD_LABELS[key] || key,
      value: formatFieldValue(key, value),
    }))
    .filter((item): item is RuleFieldItem => item.value !== "");
}

function describePageFields(page: Record<string, unknown>) {
  return [
    makeField("top_margin_cm", "上边距", page.top_margin_cm, "cm"),
    makeField("bottom_margin_cm", "下边距", page.bottom_margin_cm, "cm"),
    makeField("left_margin_cm", "左边距", page.left_margin_cm, "cm"),
    makeField("right_margin_cm", "右边距", page.right_margin_cm, "cm"),
  ].filter((item): item is RuleFieldItem => Boolean(item));
}

function makeField(key: string, label: string, value: unknown, unit = "") {
  if (typeof value !== "number" && typeof value !== "string") {
    return null;
  }
  return {
    key,
    label,
    value: `${value}${unit}`,
  };
}

function formatFieldValue(key: string, value: unknown) {
  if (key === "alignment") {
    return formatAlignment(value);
  }
  if (key === "line_spacing") {
    return formatLineSpacing(value);
  }
  if (key === "first_line_indent_pt") {
    return formatIndent(value, "pt");
  }
  if (key === "first_line_indent_chars") {
    return formatIndent(value, "chars");
  }
  if (key === "hanging_indent_chars") {
    return formatHangingIndent(value);
  }
  if (key === "space_before_lines" || key === "space_after_lines") {
    return typeof value === "number" ? `${value} 行` : "";
  }
  if (key === "space_before_pt") {
    return typeof value === "number" ? `${value} 磅` : String(value);
  }
  if (key === "space_after_pt") {
    return typeof value === "number" ? `${value} 磅` : String(value);
  }
  if (key === "bold" || key === "italic" || key === "underline") {
    return value === true ? "是" : value === false ? "否" : String(value);
  }
  if (key === "color") {
    return formatColor(value);
  }
  if (key === "size_pt") {
    return typeof value === "number" ? `${value} 磅` : String(value);
  }
  if (key === "scope") {
    return typeof value === "string" ? SCOPE_LABELS[value] || value : "";
  }
  if (key === "action" && value === "protect") {
    return "保护";
  }
  if (key === "status" && value === "detected_but_not_supported") {
    return "检测到但暂不支持";
  }
  if (key === "note") {
    return typeof value === "string" ? value : "";
  }
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

function formatAlignment(value: unknown) {
  if (typeof value !== "string") {
    return "";
  }
  return ALIGNMENT_LABELS[value] || value;
}

function formatLineSpacing(value: unknown) {
  if (typeof value === "number") {
    return `${value} 倍行距`;
  }
  if (typeof value === "string") {
    return value.includes("行距") ? value : `${value}行距`;
  }
  return "";
}

function formatColor(value: unknown) {
  if (typeof value !== "string") {
    return "";
  }
  return `#${value}`;
}

function formatIndent(value: unknown, unit: "pt" | "chars") {
  if (typeof value === "number") {
    if (value === 0) {
      return "不缩进";
    }
    return unit === "chars" ? `首行缩进 ${value} 字符` : `首行缩进 ${value} 磅`;
  }
  if (typeof value === "string") {
    return `首行缩进 ${value}`;
  }
  return "";
}

function formatHangingIndent(value: unknown) {
  if (typeof value === "number") {
    return `悬挂缩进 ${value} 字符`;
  }
  return "";
}

function formatNumberField(value: unknown, label: string, unit: string) {
  if (typeof value !== "number") {
    return "";
  }
  return `${label} ${value}${unit}`;
}

function getStyleOrder(styleName: string) {
  const index = STYLE_ORDER.indexOf(styleName);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
