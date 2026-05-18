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

const normalText = "正文宋体小四，1.5倍行距，首行缩进2字符；一级标题黑体小三。";
assert.equal(
  detectRequirementConflicts(normalText).filter((warning) => warning.includes("存在冲突"))
    .length,
  0,
);

console.log(`local parser page margin tests passed: ${cases.length}`);
