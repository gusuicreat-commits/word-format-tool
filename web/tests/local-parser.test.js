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

const { tryParseRequirementsLocally } = loadKimiModule();

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

console.log(`local parser page margin tests passed: ${cases.length}`);
