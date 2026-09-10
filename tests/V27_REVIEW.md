# V2.7 改进与审核记录

审核日期：2026-09-09。四项计划已完成本轮实现、样本扩充与审核；**结构回归通过，整篇视觉验收未全部通过**。版本标记仍为 V2.6.0，未将本工作区作为合格的新版本发布。

## 四项交付

1. **标题与章节识别**：读取 Word 自动编号定义，结合相邻章节证据识别中文“一、”类章节；增加封面后标题、多段大写英文标题识别；保留普通步骤编号和 `numId=0` 的编号取消标记。标题不确定时报告缺失，不把文库封面文字强行当作标题。
2. **可定位报告**：警告带原段落位置、文字摘录、识别类型和应用样式；界面段落/表格从 1 开始编号，JSON 索引仍从 0 开始。新增浮动图形风险、标题/一级章节缺失提醒；超宽表格及其嵌套表格保留原格式，并明确报告未处理。
3. **双模板审核**：10 个源 DOCX 全部渲染，两个模板的 20 个结果全部渲染并检查页面缩略图；对风险页查看单页图，并与相应原稿页比较。修复了宽表格被统一字体后严重裁字的问题，但保留格式不能解决所有页边距冲突。
4. **新增真实中文案例**：新增 3 个公开中文论文草稿，记录固定 Git 文件树、文件对象和 SHA-256。总样本为 10 个 DOCX，其中正文 8 份、附件 2 份，中文草稿 4 份。未把目录、提纲、开题报告充作正文，也未使用 PDF 转 DOCX。

## 新样本来源

- `chinese-koiyu.docx`：[KoiYu/GraduationProject](https://github.com/KoiYu/GraduationProject)，文件 `2017224403-于丽蔷-毕业论文-改3版.docx`。
- `chinese-x86.docx`：[aiwolflow666/biyesheji.github.io](https://github.com/aiwolflow666/biyesheji.github.io)，文件 `基于X86架构的简单操作系统内核研究与实现初稿1.docx`。
- `chinese-web.docx`：同一仓库，文件 `基于web技术的学院数据审核管理系统的设计与实现.docx`。

这是公开仓库中的真实草稿文件，不代表已发表、通过答辩或经过同行评审。固定对象与哈希见 `tests/chinese_paper_sources.json`。下载脚本读取固定文件树，不依赖最新 HEAD；已有样本只核验哈希，不覆盖。Git tree SHA 与 commit SHA 不混用。

## 验证结果

| 验证 | 结果 | 边界 |
| --- | --- | --- |
| Python 单元与回归 | 130 项通过 | 包括嵌套宽表保护、编号保留、二次处理稳定性 |
| 人工选定语义标签 | 50/50 通过 | 5 份样本的 25 个段落乘 2 个模板，不是全篇准确率 |
| 真实 DOCX 结构审核 | 20 组合通过，含二次处理共 40 次执行 | 文字、受保护 XML/部件、媒体、表格计数、页边距等；不适用检查为 null，不算通过项 |
| Web 构建 | 通过 | 包含 TypeScript 检查 |
| 解析器/UI 文案 | 通过 | 解析器 6 个页边距用例 |
| Python/API 集成 | 通过 | 默认/覆盖、下载、损坏文件、解释器缺失、超时、恢复 |
| 真实浏览器 | 桌面 1280×900、手机 390×844 通过 | 上传、报告分类及位置、下载；无页面异常、无横向溢出 |

最终纳入审核的页面：原稿 **311 页**、默认模板 **411 页**、课程论文模板 **418 页**，共 **1140 页**。两个模板的 **829 页均完成缩略图布局筛查**，原稿完成全页坐标检查并对风险位置作对照；不是 1140 页逐字逐像素人工验收。

| 样本 | 原稿 | 默认 | 课程论文 |
| --- | ---: | ---: | ---: |
| chichester-emotions | 27 | 28 | 29 |
| chinese-koiyu | 52 | 61 | 62 |
| chinese-thesis-draft | 10 | 13 | 13 |
| chinese-web | 35 | 38 | 38 |
| chinese-x86 | 50 | 55 | 55 |
| liverpool-genome | 38 | 51 | 52 |
| liverpool-genome-supplement | 51 | 65 | 66 |
| liverpool-table1 | 1 | 1 | 1 |
| liverpool-trials | 17 | 30 | 30 |
| swansea-innocence | 30 | 69 | 72 |

## 未通过与待确认项

以下页码为渲染 PDF 的物理页码，不是 Word 页脚编号。坐标检查不能识别所有重叠，也可能将不可见的图像边界列为风险。

| 样本/位置 | 结论及处理 |
| --- | --- |
| Chichester 默认/课程 p12–13 宽表 | 初次渲染分别有 122/189 个越界字符。增加保留原表格保护后为 0/4；课程 p12 仍有两行末尾裁字，最大右越界约 8.5pt。原稿 p11 表格本来超宽，但文字坐标未越界，因此残余裁字按处理后新增问题保留，未判合格。 |
| X86 默认 p25、课程 p26 的特权级图 | 原稿 p23 已有图形标签与正文重叠；两模板继续存在。默认 p25 还有 1 个越界字符。图片 XML 保留不等于位置正确。 |
| X86 两模板 p42–43 等截图 | 图片越界/覆盖正文仍存在。原稿也有浮动布局问题，但未对每张图片完成一一映射，不能全部归咎原稿。报告给出浮动图提醒，尚未自动修复锚点。 |
| Web 默认 p20–21 截图 | 原稿 p19–20 已有越界和覆盖；默认模板保留该风险。课程模板仍有流程图覆盖正文（p16），不能因图片未越界就判整篇合格。 |
| Genome supplement 默认 p54、课程 p55 附近公式 | 原稿 p41 已有方框字形及图片边界风险。输出存在公式说明字距拉大、断行不自然；字体兼容和重排影响未完全分离，仍需目标 Word/WPS 验证。 |
| 中文 GSM 草稿默认 p13 | 仅页脚，处理后新增空白尾页；课程 p13 有英文摘要正文。未删除源分页符或压缩图形以掩盖问题。标题与大图分开原稿 p3–4 已存在，输出 p4–5 保留。 |
| Koiyu 末尾评审内容 | 原稿 p50–52 已跨页，默认 p59–61、课程 p60–62 继续跨页；不是新发现就认定为新增缺陷。结论末行单独占页也是待优化的分页现象。 |
| Trials 两模板 p29–30 | 原稿 p16–17 已是仅页脚的尾页，属原稿已有问题。 |
| Swansea 标题及篇幅 | 封面后的两段标题已识别；4.1/4.2 小节仍按正文处理。原稿 30 页变为 69/72 页，中文通用模板不等于英文刊物排版标准。 |

**结论：暂不通过“自动得到可直接提交的完整论文”验收。** 现有改进减少了漏识别、给出可定位风险，且没有发现结构回归；但浮动图、特殊宽表、空白尾页、部分无规范样式小节仍需后续策略。没有自动删除内容、移动科学图形、改写公式或绕过风险提示。

## 复现与证据

使用安装了 `python-docx` 的 Python；本机验证使用 Codex bundled Python，系统默认 Python 缺少该包。渲染还需 LibreOffice、Poppler、Pillow、pdfplumber，浏览器测试需 Playwright 和 Edge。

```powershell
./tests/fetch_chinese_papers.ps1
python -m unittest discover -s tests
python -m tests.run_real_papers reports/real-papers
python -m tests.check_real_recognition reports/real-papers
python -m tests.inspect_rendered_papers reports/v27-default-visual
python -m tests.make_visual_review_sheets reports/v27-default-visual
cd web
npm run build
npm run test:parser
npm run test:ui-copy
npm run test:api
# 启动本地 HTTP 服务后，设置 PLAYWRIGHT_MODULE（未本地安装时）再执行：
node tests/report-browser.cjs
```

渲染命令与环境参数见 `tests/REAL_PAPERS.md`。下载脚本需 PowerShell 7。本地证据在 `reports/real-papers/audit.json`、`recognition-checks.json`、`chinese-sources.json` 和 `reports/v27-browser/`。

原稿在 `reports/v27-source-visual/`；输出在 `reports/v27-default-visual/`、`reports/v27-course-visual/`。**Chichester 必须使用 `reports/v27-table-fix-visual/` 的最终替代结果**；前两目录中该样本是修复前证据，不得计入最终通过率。各目录保存 PDF、逐页 PNG、坐标检查和缩略图清单。最后的嵌套表格保护调整不改变这 10 份无对应嵌套宽表的样本渲染内容。
