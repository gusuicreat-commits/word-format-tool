const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../app/page.tsx'), 'utf8');
assert.doesNotMatch(source, /技术细节|统计摘要|通用论文方案|课程论文方案|未定位到具体段落|解析格式要求|分析文档结构/);
for (const text of ['下一步', '确认并修改 Word', '下载修改后的 Word', '删除文件并重新开始', '第三方 AI', '视觉验收']) assert.ok(source.includes(text), text);
assert.match(source, /\/api\/tasks/);
console.log('Three-step UI copy passed.');
