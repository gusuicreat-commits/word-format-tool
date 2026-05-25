const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

function loadKimiModule() {
  const source = fs.readFileSync(path.join(__dirname, "..", "lib", "kimi.ts"), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;

  const moduleShim = { exports: {} };
  const localRequire = (id) => {
    if (id === "openai") {
      return function OpenAI() {};
    }
    return require(id);
  };

  new Function("require", "module", "exports", compiled)(
    localRequire,
    moduleShim,
    moduleShim.exports,
  );
  return moduleShim.exports;
}

const {
  analyzeRequirementComplexity,
  detectStructuredRuleConflicts,
  mockCanonicalRequirementsText,
  mockParseRequirements,
  normalizeAiParsedRules,
  parseCanonicalRequirementsText,
  tryParseRequirementsLocally,
  validateOverrideAgainstSchema,
} = loadKimiModule();

const cases = [
  {
    text: "页边距为上2.5厘米，下2.5厘米，左3厘米，右2.5厘米。",
    page: {
      top_margin_cm: 2.5,
      bottom_margin_cm: 2.5,
      left_margin_cm: 3,
      right_margin_cm: 2.5,
    },
  },
  {
    text: "页边距：上 2.5cm，下 2.5cm，左 3cm，右 2.5cm。",
    page: {
      top_margin_cm: 2.5,
      bottom_margin_cm: 2.5,
      left_margin_cm: 3,
      right_margin_cm: 2.5,
    },
  },
  {
    text: "上边距2.5厘米，下边距2.5厘米，左边距3厘米，右边距2.5厘米。",
    page: {
      top_margin_cm: 2.5,
      bottom_margin_cm: 2.5,
      left_margin_cm: 3,
      right_margin_cm: 2.5,
    },
  },
  {
    text: "左边距3cm，其余2.5cm。",
    page: {
      top_margin_cm: 2.5,
      bottom_margin_cm: 2.5,
      left_margin_cm: 3,
      right_margin_cm: 2.5,
    },
  },
  {
    text: "页边距上下左右均为2.5厘米。",
    page: {
      top_margin_cm: 2.5,
      bottom_margin_cm: 2.5,
      left_margin_cm: 2.5,
      right_margin_cm: 2.5,
    },
  },
  {
    text: "页边距上下2.5厘米，左右3厘米。",
    page: {
      top_margin_cm: 2.5,
      bottom_margin_cm: 2.5,
      left_margin_cm: 3,
      right_margin_cm: 3,
    },
  },
];

for (const item of cases) {
  const result = tryParseRequirementsLocally(item.text);
  assert.ok(result, `Expected parser result for: ${item.text}`);
  assert.deepEqual(result.page, item.page, item.text);
}

const conflictText = [
  "正文宋体小四，1.5倍行距，首行缩进2字符；",
  "正文微软雅黑五号，单倍行距；",
  "一级标题黑体小三左对齐；",
  "一级标题宋体四号居中；",
  "参考文献条目宋体五号，左对齐，单倍行距；",
  "参考文献条目居中；",
].join("\n");
const localConflictResult = tryParseRequirementsLocally(conflictText);
assert.ok(localConflictResult, "Expected local parser to parse conflict text");
const conflictWarnings = localConflictResult.warnings;
assert.ok(
  conflictWarnings.some((warning) => warning.includes("正文 font 存在冲突")),
  conflictWarnings.join("\n"),
);
assert.ok(
  conflictWarnings.some((warning) => warning.includes("正文 size 存在冲突")),
  conflictWarnings.join("\n"),
);
assert.ok(
  conflictWarnings.some((warning) => warning.includes("正文 line_spacing 存在冲突")),
  conflictWarnings.join("\n"),
);
assert.ok(
  conflictWarnings.some((warning) => warning.includes("一级标题 font 存在冲突")),
  conflictWarnings.join("\n"),
);
assert.ok(
  conflictWarnings.some((warning) => warning.includes("一级标题 size 存在冲突")),
  conflictWarnings.join("\n"),
);
assert.ok(
  conflictWarnings.some((warning) => warning.includes("一级标题 alignment 存在冲突")),
  conflictWarnings.join("\n"),
);
assert.ok(
  conflictWarnings.some((warning) =>
    warning.includes("参考文献条目 alignment 存在冲突"),
  ),
  conflictWarnings.join("\n"),
);

assert.ok(
  localConflictResult.warnings.some(
    (warning) => typeof warning === "string" && warning.includes("存在冲突"),
  ),
  JSON.stringify(localConflictResult.warnings),
);

const clearUnderlineResult = tryParseRequirementsLocally(
  "全文文字颜色统一为黑色，清除正文中多余的下划线。",
);
assert.ok(clearUnderlineResult, "Expected local parser to parse underline cleanup");
assert.equal(clearUnderlineResult.styles.body.underline, false);

const removeUnderlineResult = tryParseRequirementsLocally("正文去除下划线，一级标题取消下划线。");
assert.ok(removeUnderlineResult, "Expected local parser to parse underline removal");
assert.equal(removeUnderlineResult.styles.body.underline, false);
assert.equal(removeUnderlineResult.styles.heading_1.underline, false);

const addUnderlineResult = tryParseRequirementsLocally("正文使用下划线。");
assert.ok(addUnderlineResult, "Expected local parser to parse underline add");
assert.equal(addUnderlineResult.styles.body.underline, true);

const englishAbstractResult = tryParseRequirementsLocally(
  "英文摘要 Times New Roman 小四加粗；英文关键词 Times New Roman 小四加粗。",
);
assert.ok(englishAbstractResult, "Expected local parser to parse English abstract rules");
assert.ok(!englishAbstractResult.styles.abstract_content);
assert.ok(!englishAbstractResult.styles.keywords);
assert.equal(englishAbstractResult.styles.abstract_en_content.font, "Times New Roman");
assert.equal(englishAbstractResult.styles.keywords_en.font, "Times New Roman");
assert.ok(!englishAbstractResult.latin_digit_format);

const latinDigitBodyResult = tryParseRequirementsLocally(
  "正文中文使用宋体小四，正文中的英文和数字使用 Times New Roman 小四号。",
);
assert.ok(latinDigitBodyResult, "Expected local parser to parse Latin digit body rule");
assert.equal(latinDigitBodyResult.styles.body.font, "宋体");
assert.equal(latinDigitBodyResult.styles.body.size_cn, "小四");
assert.equal(latinDigitBodyResult.latin_digit_format.font, "Times New Roman");
assert.equal(latinDigitBodyResult.latin_digit_format.size_cn, "小四");
assert.equal(latinDigitBodyResult.latin_digit_format.scope, "body");
assert.ok(
  !latinDigitBodyResult.warnings.some((warning) =>
    warning.includes("正文 font 存在冲突：宋体 vs Times New Roman"),
  ),
);

const latinDigitGenericChineseResult = tryParseRequirementsLocally(
  "中文宋体，英文和阿拉伯数字 Times New Roman。",
);
assert.equal(latinDigitGenericChineseResult, null);
assert.equal(
  analyzeRequirementComplexity("中文宋体，英文和阿拉伯数字 Times New Roman。").parserMode,
  "kimi_canonical",
);

const latinDigitCompactBodyResult = tryParseRequirementsLocally(
  "正文中文宋体，英文数字 Times New Roman。",
);
assert.ok(latinDigitCompactBodyResult, "Expected compact Latin digit body rule");
assert.equal(latinDigitCompactBodyResult.styles.body.font, "宋体");
assert.equal(latinDigitCompactBodyResult.latin_digit_format.font, "Times New Roman");
assert.ok(
  !latinDigitCompactBodyResult.warnings.some((warning) =>
    warning.includes("正文 font 存在冲突"),
  ),
);

const latinDigitFullTextResult = tryParseRequirementsLocally(
  "全文英文、数字均采用 Times New Roman。",
);
assert.equal(latinDigitFullTextResult, null);
assert.equal(
  analyzeRequirementComplexity("全文英文、数字均采用 Times New Roman。").parserMode,
  "kimi_canonical",
);

const exactEnglishAbstractResult = tryParseRequirementsLocally(
  "英文摘要 Abstract 使用 Times New Roman 小四。",
);
assert.ok(exactEnglishAbstractResult, "Expected exact English abstract rule");
assert.equal(exactEnglishAbstractResult.styles.abstract_en_title.font, "Times New Roman");
assert.equal(exactEnglishAbstractResult.styles.abstract_en_content.font, "Times New Roman");
assert.ok(!exactEnglishAbstractResult.latin_digit_format);
assert.ok(!exactEnglishAbstractResult.styles.body);

const fullLatinDigitAcceptanceText = `论文标题黑体三号，加粗，居中。
一级标题黑体小三，加粗，左对齐。
二级标题黑体四号，加粗，左对齐。
三级标题黑体小四，加粗，左对齐。
正文中文使用宋体小四，1.5倍行距，首行缩进2字符，两端对齐。
正文中的英文和数字使用 Times New Roman 小四号。
中文摘要和关键词使用宋体小四。
参考文献标题黑体四号居中。
参考文献条目宋体五号，单倍行距，左对齐。
目录保持原有结构，不自动生成目录，不自动更新目录。
全文颜色统一黑色，清除正文中多余的下划线。`;
const fullLatinDigitAcceptanceResult = tryParseRequirementsLocally(fullLatinDigitAcceptanceText);
assert.equal(fullLatinDigitAcceptanceResult, null);
assert.equal(analyzeRequirementComplexity(fullLatinDigitAcceptanceText).parserMode, "kimi_canonical");

const normalText = "正文宋体小四，1.5倍行距，首行缩进2字符；一级标题黑体小三。";
assert.equal(
  detectStructuredRuleConflicts(tryParseRequirementsLocally(normalText)).warnings.filter((warning) =>
    warning.includes("存在冲突"),
  ).length,
  0,
);

const clinicalRequirements = `中文摘要标题“摘要”使用黑体小四号，加粗，居中。
中文摘要正文使用宋体小四号，1.5倍行距，首行缩进2字符，两端对齐。
关键词：标签黑体小四加粗，后面内容宋体小四不加粗。
英文摘要标题 Abstract 使用 Times New Roman 小四号，加粗，居中。
英文摘要正文使用 Times New Roman 小四号，1.5倍行距，两端对齐，不设置首行缩进。
Keywords: 标签 Times New Roman 小四加粗，后面内容 Times New Roman 小四不加粗。
正文中文使用宋体小四号，正文中的英文和数字使用 Times New Roman 小四号。
参考文献条目使用宋体五号，参考文献中的英文、期刊名、卷期号、页码和年份统一使用 Times New Roman 五号。
目录保持原有结构，不自动生成目录，不自动更新目录。
页眉显示论文题目，页码位于页脚居中。`;
const clinicalComplexity = analyzeRequirementComplexity(clinicalRequirements);
assert.equal(clinicalComplexity.parserMode, "kimi_canonical");
assert.equal(tryParseRequirementsLocally(clinicalRequirements), null);
const clinicalCanonicalText = mockCanonicalRequirementsText(clinicalRequirements);
assert.match(clinicalCanonicalText, /中文摘要标题/);
assert.match(clinicalCanonicalText, /中文摘要正文/);
assert.match(clinicalCanonicalText, /英文摘要标题/);
assert.match(clinicalCanonicalText, /英文摘要正文/);
assert.match(clinicalCanonicalText, /正文英文数字/);
assert.match(clinicalCanonicalText, /参考文献英文数字/);
assert.match(clinicalCanonicalText, /页眉页脚：暂不支持；仅提醒/);
assert.match(clinicalCanonicalText, /页码：暂不支持；仅提醒/);
const clinicalCanonicalParsed = parseCanonicalRequirementsText(clinicalCanonicalText, {
  requirementsText: clinicalRequirements,
});
assert.equal(validateOverrideAgainstSchema(clinicalCanonicalParsed.rules).valid, true);
assert.equal(clinicalCanonicalParsed.rules.styles.abstract_cn_title.font, "黑体");
assert.equal(clinicalCanonicalParsed.rules.styles.abstract_cn_content.font, "宋体");
assert.equal(clinicalCanonicalParsed.rules.latin_digit_format.scope, "body");
assert.equal(clinicalCanonicalParsed.rules.reference_latin_digit_format.scope, "reference");
assert.equal(
  clinicalCanonicalParsed.rules.unsupported_modules.header_footer.action,
  "warning_only",
);
const clinicalMock = mockParseRequirements(clinicalRequirements);
assert.ok(clinicalMock.styles.abstract_cn_title);
assert.ok(clinicalMock.styles.abstract_cn_content);
assert.ok(clinicalMock.styles.keywords_cn_label);
assert.ok(clinicalMock.styles.keywords_cn_content);
assert.ok(clinicalMock.styles.abstract_en_title);
assert.ok(clinicalMock.styles.abstract_en_content);
assert.ok(clinicalMock.styles.keywords_en_label);
assert.ok(clinicalMock.styles.keywords_en_content);
assert.ok(clinicalMock.reference_latin_digit_format);
assert.ok(clinicalMock.unsupported_modules.header_footer);
assert.ok(clinicalMock.unsupported_modules.page_number);
assert.equal(validateOverrideAgainstSchema(clinicalMock).valid, true);

const simpleRequirements = "正文宋体小四，1.5倍行距。";
assert.equal(analyzeRequirementComplexity(simpleRequirements).parserMode, "local");
const simpleResult = tryParseRequirementsLocally(simpleRequirements);
assert.ok(simpleResult);
assert.equal(simpleResult.styles.body.font, "宋体");

const structuredNoConflict = {
  styles: {
    body: { font: "宋体" },
    reference_item: { font: "宋体" },
    abstract_cn_title: { font: "黑体" },
    abstract_cn_content: { font: "宋体" },
    keywords_cn_label: { font: "黑体", bold: true },
    keywords_cn_content: { font: "宋体", bold: false },
    abstract_en_title: { alignment: "center" },
    abstract_en_content: { alignment: "justify" },
    keywords_en_label: { bold: true },
    keywords_en_content: { bold: false },
  },
  latin_digit_format: { font: "Times New Roman", scope: "body" },
  reference_latin_digit_format: { font: "Times New Roman", scope: "reference" },
};
assert.equal(detectStructuredRuleConflicts(structuredNoConflict).warnings.length, 0);

const indentEquivalentNoConflict = {
  styles: {
    body: {
      size_cn: "小四",
      first_line_indent_chars: 2,
      first_line_indent_pt: 24,
    },
  },
};
assert.equal(
  detectStructuredRuleConflicts(indentEquivalentNoConflict).warnings.filter((warning) =>
    warning.includes("first_line_indent_pt"),
  ).length,
  0,
);

const indentMismatchConflict = {
  styles: {
    body: {
      size_cn: "小四",
      first_line_indent_chars: 2,
      first_line_indent_pt: 12,
    },
  },
};
assert.ok(
  detectStructuredRuleConflicts(indentMismatchConflict).warnings.some((warning) =>
    warning.includes("first_line_indent_pt"),
  ),
);

const unsupportedOnly = mockParseRequirements("页眉显示论文题目，页码位于页脚居中。");
assert.equal(unsupportedOnly.unsupported_modules.header_footer.status, "detected_but_not_supported");
assert.equal(unsupportedOnly.unsupported_modules.header_footer.action, "warning_only");
assert.equal(unsupportedOnly.unsupported_modules.page_number.status, "detected_but_not_supported");
assert.equal(unsupportedOnly.unsupported_modules.page_number.action, "warning_only");

const canonicalSample = [
  "正文：宋体；小四；1.5倍行距；首行缩进2字符；两端对齐",
  "正文英文数字：Times New Roman；小四",
  "参考文献条目：宋体；五号；单倍行距；左对齐；悬挂缩进2字符",
  "参考文献英文数字：Times New Roman；五号",
  "页眉页脚：暂不支持；仅提醒",
  "页码：暂不支持；仅提醒",
].join("\n");
const canonicalSampleParsed = parseCanonicalRequirementsText(canonicalSample);
assert.equal(validateOverrideAgainstSchema(canonicalSampleParsed.rules).valid, true);
assert.equal(canonicalSampleParsed.rules.styles.body.font, "宋体");
assert.equal(canonicalSampleParsed.rules.styles.body.line_spacing, 1.5);
assert.equal(canonicalSampleParsed.rules.styles.body.first_line_indent_chars, 2);
assert.equal(canonicalSampleParsed.rules.latin_digit_format.font, "Times New Roman");
assert.equal(canonicalSampleParsed.rules.styles.reference_item.font, "宋体");
assert.equal(canonicalSampleParsed.rules.styles.reference_item.hanging_indent_chars, 2);
assert.equal(
  canonicalSampleParsed.rules.reference_latin_digit_format.font,
  "Times New Roman",
);
assert.equal(canonicalSampleParsed.rules.unsupported_modules.header_footer.action, "warning_only");
assert.equal(canonicalSampleParsed.rules.unsupported_modules.page_number.action, "warning_only");

const jsonLikeKimiOutput = JSON.stringify({
  styles: { body: { font: "黑体" } },
});
const jsonFallbackParsed = parseCanonicalRequirementsText(jsonLikeKimiOutput, {
  requirementsText: "正文宋体小四，1.5倍行距。",
});
assert.ok(jsonFallbackParsed.warnings.some((warning) => warning.includes("Kimi 返回了 JSON")));
assert.notEqual(jsonFallbackParsed.rules.styles?.body?.font, "黑体");
assert.equal(jsonFallbackParsed.rules.styles.body.font, "宋体");

const pageHeaderNormalize = normalizeAiParsedRules({
  styles: { body: { font: "宋体" } },
  unsupported_modules: {
    page_header: {
      status: "detected_but_not_supported",
      action: "warning_only",
      note: "页眉显示论文题目。",
    },
  },
});
assert.ok(pageHeaderNormalize.rules.unsupported_modules.header_footer);
assert.ok(!pageHeaderNormalize.rules.unsupported_modules.page_header);
assert.equal(validateOverrideAgainstSchema(pageHeaderNormalize.rules).valid, true);

const pageFooterNormalize = normalizeAiParsedRules({
  styles: { body: { font: "宋体" } },
  unsupported_modules: {
    page_footer: "页脚居中显示页码。",
  },
});
assert.ok(pageFooterNormalize.rules.unsupported_modules.header_footer);
assert.ok(!pageFooterNormalize.rules.unsupported_modules.page_footer);
assert.equal(validateOverrideAgainstSchema(pageFooterNormalize.rules).valid, true);

const hangingIndentNormalize = normalizeAiParsedRules({
  styles: { reference_item: { font: "宋体" } },
  unsupported_modules: {
    hanging_indent: {
      status: "detected_but_not_supported",
      action: "warning_only",
      note: "参考文献悬挂缩进 2 字符。",
    },
  },
});
assert.ok(!hangingIndentNormalize.rules.unsupported_modules);
assert.ok(hangingIndentNormalize.warnings.some((warning) => warning.includes("hanging_indent")));
assert.equal(validateOverrideAgainstSchema(hangingIndentNormalize.rules).valid, true);

const textFormattingNormalize = normalizeAiParsedRules({
  styles: { body: { font: "宋体" } },
  unsupported_modules: {
    text_formatting: {
      status: "detected_but_not_supported",
      action: "warning_only",
      note: "全文颜色黑色，清除正文中多余的下划线。",
    },
  },
});
assert.equal(textFormattingNormalize.rules.styles.body.color, "000000");
assert.equal(textFormattingNormalize.rules.styles.body.underline, false);
assert.ok(!textFormattingNormalize.rules.unsupported_modules);
assert.equal(validateOverrideAgainstSchema(textFormattingNormalize.rules).valid, true);

const clinicalRawAiRules = {
  ...clinicalMock,
  unsupported_modules: {
    ...clinicalMock.unsupported_modules,
    page_header: "页眉显示论文题目。",
    text_formatting: "全文颜色黑色，清除正文中多余的下划线。",
  },
};
const clinicalNormalized = normalizeAiParsedRules(clinicalRawAiRules, {
  requirementsText: clinicalRequirements,
});
assert.equal(validateOverrideAgainstSchema(clinicalNormalized.rules).valid, true);
assert.ok(clinicalRawAiRules);
assert.ok(clinicalNormalized.rules);
assert.ok(clinicalNormalized.rules.unsupported_modules.header_footer);
assert.ok(clinicalNormalized.rules.unsupported_modules.page_number);
assert.ok(clinicalNormalized.warnings.length > 0);

const routeSource = fs.readFileSync(
  path.join(__dirname, "..", "app", "api", "parse-requirements", "route.ts"),
  "utf8",
);
assert.ok(
  routeSource.indexOf("normalizeAiParsedRules(rawParsedRules") <
    routeSource.indexOf("validateOverrideAgainstSchema(normalizedAiRules"),
  "Expected route to normalize AI rules before schema validation",
);
assert.match(routeSource, /raw_ai_rules/);
assert.match(routeSource, /normalized_ai_rules/);
assert.match(routeSource, /validated_rules/);
assert.match(routeSource, /canonicalRequirementsText/);
assert.match(routeSource, /parseCanonicalRequirementsText/);
assert.match(routeSource, /callKimiForCanonicalRequirements/);
assert.doesNotMatch(routeSource, /callKimiForRequirements\(requirementsText\)/);
assert.ok(
  routeSource.indexOf("parseCache.get(cacheKey)") <
    routeSource.indexOf("callKimiForCanonicalRequirements(requirementsText)"),
  "Expected parser cache lookup before Kimi call",
);

console.log(`local parser page margin tests passed: ${cases.length}`);
