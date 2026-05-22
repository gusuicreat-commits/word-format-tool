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

const { detectRequirementConflicts, tryParseRequirementsLocally } = loadKimiModule();

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
const conflictWarnings = detectRequirementConflicts(conflictText);
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

const localConflictResult = tryParseRequirementsLocally(conflictText);
assert.ok(localConflictResult, "Expected local parser to parse conflict text");
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
assert.ok(latinDigitGenericChineseResult, "Expected generic Chinese/Latin digit split rule");
assert.equal(latinDigitGenericChineseResult.styles.body.font, "宋体");
assert.equal(latinDigitGenericChineseResult.latin_digit_format.font, "Times New Roman");
assert.ok(!latinDigitGenericChineseResult.styles.body.font.includes("Times New Roman"));

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
assert.ok(latinDigitFullTextResult, "Expected local parser to parse Latin digit full text rule");
assert.equal(latinDigitFullTextResult.latin_digit_format.font, "Times New Roman");
assert.equal(latinDigitFullTextResult.latin_digit_format.scope, "global");

const exactEnglishAbstractResult = tryParseRequirementsLocally(
  "英文摘要 Abstract 使用 Times New Roman 小四。",
);
assert.ok(exactEnglishAbstractResult, "Expected exact English abstract rule");
assert.equal(exactEnglishAbstractResult.styles.abstract_en_title.font, "Times New Roman");
assert.equal(exactEnglishAbstractResult.styles.abstract_en_content.font, "Times New Roman");
assert.ok(!exactEnglishAbstractResult.latin_digit_format);
assert.ok(!exactEnglishAbstractResult.styles.body);

const fullLatinDigitAcceptanceResult = tryParseRequirementsLocally(`论文标题黑体三号，加粗，居中。
一级标题黑体小三，加粗，左对齐。
二级标题黑体四号，加粗，左对齐。
三级标题黑体小四，加粗，左对齐。
正文中文使用宋体小四，1.5倍行距，首行缩进2字符，两端对齐。
正文中的英文和数字使用 Times New Roman 小四号。
中文摘要和关键词使用宋体小四。
参考文献标题黑体四号居中。
参考文献条目宋体五号，单倍行距，左对齐。
目录保持原有结构，不自动生成目录，不自动更新目录。
全文颜色统一黑色，清除正文中多余的下划线。`);
assert.ok(fullLatinDigitAcceptanceResult, "Expected full Latin digit acceptance rule");
assert.equal(fullLatinDigitAcceptanceResult.styles.body.font, "宋体");
assert.equal(fullLatinDigitAcceptanceResult.styles.body.underline, false);
assert.equal(fullLatinDigitAcceptanceResult.latin_digit_format.font, "Times New Roman");
assert.equal(fullLatinDigitAcceptanceResult.styles.abstract_content.font, "宋体");
assert.equal(fullLatinDigitAcceptanceResult.styles.keywords.font, "宋体");
assert.ok(!fullLatinDigitAcceptanceResult.styles.abstract_en_content);
assert.ok(
  !fullLatinDigitAcceptanceResult.warnings.some((warning) =>
    warning.includes("正文 font 存在冲突：宋体 vs Times New Roman"),
  ),
);

const normalText = "正文宋体小四，1.5倍行距，首行缩进2字符；一级标题黑体小三。";
assert.equal(
  detectRequirementConflicts(normalText).filter((warning) => warning.includes("存在冲突"))
    .length,
  0,
);

console.log(`local parser page margin tests passed: ${cases.length}`);
