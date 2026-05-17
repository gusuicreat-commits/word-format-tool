export type OverrideRules = {
  name?: string;
  description?: string;
  page?: Record<string, unknown>;
  styles?: Record<string, Record<string, unknown>>;
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
  abstract_title: "摘要标题",
  abstract_content: "摘要正文",
  keywords: "关键词",
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
  "body",
  "abstract_title",
  "abstract_content",
  "keywords",
  "heading_1",
  "heading_2",
  "heading_3",
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

const FIELD_LABELS: Record<string, string> = {
  font: "字体",
  color: "颜色",
  size_cn: "字号",
  size_pt: "字号",
  bold: "加粗",
  italic: "斜体",
  alignment: "对齐方式",
  line_spacing: "行距",
  first_line_indent_pt: "首行缩进",
  space_before_pt: "段前",
  space_after_pt: "段后",
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

  return Array.from(new Set(fields));
}

export function getFinalRulesPreview(finalRules: unknown) {
  if (!isPlainObject(finalRules) || !isPlainObject(finalRules.styles)) {
    return {};
  }

  const preview: Record<string, unknown> = {};
  const styles = finalRules.styles as Record<string, unknown>;
  for (const styleName of STYLE_ORDER) {
    if (styles[styleName]) {
      preview[styleName] = styles[styleName];
    }
  }

  if (isPlainObject(finalRules.page)) {
    preview.page = finalRules.page;
  }

  return preview;
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
    style.italic === true ? "斜体" : "",
    formatAlignment(style.alignment),
    formatColor(style.color),
    formatLineSpacing(style.line_spacing),
    formatIndent(style.first_line_indent_pt),
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
    return formatIndent(value);
  }
  if (key === "space_before_pt") {
    return typeof value === "number" ? `${value} 磅` : String(value);
  }
  if (key === "space_after_pt") {
    return typeof value === "number" ? `${value} 磅` : String(value);
  }
  if (key === "bold" || key === "italic") {
    return value === true ? "是" : value === false ? "否" : String(value);
  }
  if (key === "color") {
    return formatColor(value);
  }
  if (key === "size_pt") {
    return typeof value === "number" ? `${value} 磅` : String(value);
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

function formatIndent(value: unknown) {
  if (typeof value === "number") {
    if (value === 0) {
      return "不缩进";
    }
    return `首行缩进 ${value} 磅`;
  }
  if (typeof value === "string") {
    return `首行缩进 ${value}`;
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
