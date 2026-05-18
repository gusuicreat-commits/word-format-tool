const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const pageSource = fs.readFileSync(path.join(__dirname, "..", "app", "page.tsx"), "utf8");

assert.match(pageSource, /当前基础模板：/);
assert.match(pageSource, /未明确说明的格式将继承基础模板/);
assert.match(pageSource, /系统只会用老师要求覆盖其中对应字段/);
assert.match(pageSource, /下方仅显示老师要求中识别出的覆盖字段/);
assert.match(pageSource, /通用默认模板/);
assert.match(pageSource, /课程论文模板/);
assert.match(pageSource, /templateName \|\| "default"/);
assert.match(pageSource, /显示\/隐藏编辑标记/);
assert.match(pageSource, /不属于正文内容/);
assert.match(pageSource, /不影响打印和提交/);
assert.match(pageSource, /检测到格式要求冲突/);
assert.match(pageSource, /请人工确认/);
assert.match(pageSource, /已暂按后者覆盖/);
assert.match(pageSource, /存在格式冲突/);

console.log("ui copy tests passed");
