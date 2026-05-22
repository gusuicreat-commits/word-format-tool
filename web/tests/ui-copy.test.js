const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const pageSource = fs.readFileSync(path.join(__dirname, "..", "app", "page.tsx"), "utf8");

assert.match(pageSource, /步骤 1：上传论文/);
assert.match(pageSource, /步骤 2：粘贴格式要求/);
assert.match(pageSource, /AI 负责理解要求，程序负责修改 Word/);
assert.match(pageSource, /当前基础模板：/);
assert.match(pageSource, /未明确说明的格式将继承基础模板/);
assert.match(pageSource, /正文、标题、摘要关键词、图题表题、参考文献和页边距/);
assert.match(pageSource, /高级设置（一般无需修改）/);
assert.match(pageSource, /查看继承内容/);
assert.match(pageSource, /开发者选项/);
assert.match(pageSource, /普通用户请直接粘贴老师的自然语言格式要求/);
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
assert.match(pageSource, /本次检测到的论文结构模块/);
assert.match(pageSource, /系统只处理高置信度识别到的结构/);
assert.match(pageSource, /未检测到或未明确要求的模块不会强行修改/);

console.log("ui copy tests passed");
