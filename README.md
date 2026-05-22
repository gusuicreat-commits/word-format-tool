# 文格 Lite：本地版 Word 论文格式修改器

文格 Lite 是一个本地命令行 Python 工具，用来自动修改 `.docx` 论文格式。

当前版本是 **V2.6.0**。V2.0 新增了本地 Next.js 网页上传版：用户可以在浏览器里上传 `.docx`，选择模板，点击处理，下载修改后的 Word，并查看 `report.json` 的摘要结果。V2.1 优化了模板显示、摘要统计和图题/表题识别。V2.2 新增格式规则 Schema 标准化。V2.3 新增模板继承与覆盖机制：默认模板提供完整规则，自定义 override JSON 只覆盖用户想改的字段。V2.3.1 优化了网页交互。V2.4 接入 Kimi API，把老师自然语言格式要求解析为标准 override JSON，再复用现有 Python 处理链路。V2.4.1 修正字体颜色残留和 AI 过度推断问题。V2.4.3 增加图题/表题分页保护，并在网页中明确展示当前基础模板和继承说明。V2.5.0 对应 V0.2“保守式模块触发状态报告版”，新增 `module_status` 报告。V2.6.0 对应 V0.3-step1，新增保守的英文和数字字符格式规则。

Python 命令行工具仍然是核心处理引擎。Next.js 负责上传、调用、展示、下载，以及在服务端调用 Kimi 把老师格式要求解析为 override JSON；AI 不读取 Word、不修改 Word、不执行命令。不做公网部署、登录系统或数据库。

识别逻辑不是 AI，而是 `python-docx` 段落遍历加 `re` 正则表达式。报告只是规则识别日志，不是 AI 审稿。

## V2.1 小优化

- 模板下拉框现在显示中文说明，例如 `通用默认模板（default）`、`课程论文模板（course_paper）`。
- 网页统计中把 `摘要：xxx` 这种同段写法计入“摘要相关段落”，这是正常情况，不代表摘要没有识别。
- 新增图题、表题规则识别，支持 `表1 xxx`、`表 1 xxx`、`表1-1 xxx`、`图1 xxx`、`图 1 xxx`、`图1-1 xxx`。
- 图题、表题过长时会写入 warning，提醒人工确认。

## V2.2 格式规则标准化

V2.2 新增 `schemas/format_rules.schema.json`，用于说明合法的格式规则 JSON 应该长什么样。

模板读取流程现在是：

```text
读取 JSON
↓
normalize 规范化
↓
validate 校验
↓
通过后用于修改 Word
```

规范化能力包括：

- 中文字号：`小四` → `12`，`五号` → `10.5`。
- 中文对齐：`居中` → `center`，`两端对齐` → `justify`。
- 行距字符串：`1.5倍` → `1.5`，`单倍行距` → `1.0`。
- 首行缩进：`2字符` → `24`，`不缩进` → `0`。

校验模板：

```bash
python format_docx.py --validate-template templates/default.json
python format_docx.py --validate-template templates/course_paper.json
```

这一步是为后续“老师自然语言格式要求 → AI 解析为 `teacher_override.json`”做准备。当前 V2.2/V2.3 还没有接入 AI，只是先建立统一、可校验、可合并的结构化格式规则。

## V2.3 模板继承与覆盖

V2.3 支持：

```text
基础模板 default.json
↓
局部覆盖 teacher_override.json
↓
最终完整格式规则 final_rules.json
↓
修改 Word
```

默认模板负责提供完整格式规则。老师或用户的自定义覆盖 JSON 只需要写想修改的字段，没写的字段会自动继承默认模板。

示例 override 文件：[teacher_override.json](overrides/teacher_override.json)

```json
{
  "name": "teacher_custom",
  "description": "老师课堂论文自定义要求示例",
  "styles": {
    "body": {
      "font": "微软雅黑",
      "size_cn": "五号"
    }
  }
}
```

使用 override 处理 Word：

```bash
python format_docx.py samples/input.docx samples/output.docx --template default --override overrides/teacher_override.json --report reports/report.json --overwrite
```

只合并规则、不处理 Word：

```bash
python format_docx.py --template default --override overrides/teacher_override.json --export-final-rules reports/final_rules.json --merge-rules
```

处理 Word 时也可以同时导出最终规则：

```bash
python format_docx.py samples/input.docx samples/output.docx --template default --override overrides/teacher_override.json --export-final-rules reports/final_rules.json --report reports/report.json --overwrite
```

网页端也支持在文本框中粘贴 override JSON：上传 Word 文件后，可以直接粘贴自定义覆盖规则。高级设置中仍保留“上传自定义覆盖规则 JSON 文件”作为备用方式。不填写文本框、不上传 override 时，保持默认模板处理逻辑。

当前 V2.3 还没有接入 AI，也不会解析自然语言。后续 V2.4 可以让 AI 把老师自然语言要求解析成 override JSON，再走同一套合并和校验流程。

## V2.3.1 前端交互优化
V2.3.1 把网页主界面调整为更接近最终产品的使用方式：

1. 上传 Word 论文。
2. 在大文本框中粘贴格式要求。
3. 点击开始处理。
4. 下载修改后的 Word，并查看处理报告摘要。

V2.3.1 当时还没有接入 AI，也不会真正解析自然语言；文本框只支持 **JSON 覆盖规则**。V2.4 已新增 Kimi 解析入口。

如果粘贴：

```text
正文宋体小四，一级标题黑体小三。
```

网页会提示当前版本暂不支持自然语言解析。

当前应粘贴类似下面的 JSON：

```json
{
  "styles": {
    "body": {
      "font": "宋体",
      "size_cn": "小四"
    },
    "heading_1": {
      "font": "黑体",
      "size_cn": "小三",
      "alignment": "居中"
    }
  }
}
```

基础模板选择已经移动到“高级设置”中，默认使用 `default`。高级设置里仍然保留上传 override JSON 文件的备用方式；如果同时填写文本框和上传 JSON 文件，系统会优先使用文本框中的规则，并忽略上传文件。

## V2.4 Kimi 自然语言解析
V2.4 新增 Kimi API 接入。Kimi 只负责把老师的自然语言格式要求解析成 override JSON，不直接修改 Word，不读取 `.docx`，不执行命令，也不生成代码。

实际执行流程仍然是：

```text
老师自然语言格式要求
↓
Kimi API 或本地 mock 解析为 override JSON
↓
Python normalize / validate / merge-rules 校验合并
↓
生成 final_rules.json
↓
format_docx.py 修改 Word
↓
生成 output.docx 和 report.json
```

### 配置 Kimi
先复制示例环境变量文件：

```powershell
copy web\.env.example web\.env.local
```

然后在 `web/.env.local` 中填写：

```env
KIMI_API_KEY=你的Kimi_API_Key
KIMI_BASE_URL=https://api.moonshot.ai/v1
KIMI_MODEL=你的模型名
PYTHON_CMD=python
ENABLE_KIMI_MOCK=false
```

不要把真实 API Key 写进代码或提交到仓库。`web/.gitignore` 已经忽略 `.env.local`。

如果暂时没有 Kimi API Key，可以启用本地 mock 模式测试完整流程：

```env
ENABLE_KIMI_MOCK=true
```

mock 模式只用于本地开发测试。正式使用时仍然需要配置 `KIMI_API_KEY` 和 `KIMI_MODEL`。

### 网页使用流程
```bash
cd web
npm install
npm run dev
```

打开：

```text
http://localhost:3000
```

使用步骤：

1. 上传 Word。
2. 粘贴老师格式要求，例如：`正文宋体小四，1.5倍行距，一级标题黑体小三居中，参考文献宋体五号。`
3. 点击“解析格式要求”。
4. 检查识别出的格式规则和系统提醒。
5. 点击“开始处理”。
6. 下载修改后的 Word。

常见问题：

- 没有 API Key：配置 `KIMI_API_KEY`，或临时设置 `ENABLE_KIMI_MOCK=true`。
- 未配置模型名：设置 `KIMI_MODEL`。
- Kimi 返回 JSON 失败：老师要求可能太模糊，建议拆成“正文、标题、参考文献”等明确句子。
- AI 解析结果需要人工确认：网页会展示识别摘要和 warning，处理前请先检查。
- mock 模式结果不代表真实 AI 能力，只用于验证流程。

## V2.4.1 严格解析与颜色修复

V2.4.1 修正了测试中发现的三个问题：

- 格式模板新增 `color` 字段，默认主要样式为 `000000` 黑色，避免输出 Word 保留原文蓝色、红色等字体颜色。
- Kimi prompt 更严格：老师没有明确写“居中”“加粗”“行距”等字段时，不允许 AI 自动补充。
- 增加轻量过度推断 warning：如果 AI 给一级标题、参考文献等输出了原文附近没有提到的对齐、行距或加粗设置，页面会提醒人工确认。

`color` 字段使用 6 位十六进制颜色值：

```json
{
  "styles": {
    "body": {
      "font": "宋体",
      "size_cn": "小四",
      "color": "000000"
    }
  }
}
```

也支持简单中文颜色规范化：`黑色` → `000000`，`红色` → `FF0000`，`蓝色` → `0000FF`。

网页解析结果现在会逐字段展示，例如 `font = 黑体`、`size_cn = 小三`、`alignment = center`，便于检查 AI 是否多输出了未说明的字段。

## V2.4.3 图表题分页保护

V2.4.3 为图题和表题新增 Word 分页控制：

- `table_caption` 和 `figure_caption` 默认设置 `keep_with_next: true`，尽量与后续表格、图片或占位内容保持在同一页。
- 同时设置 `keep_together: true`，避免图题、表题段落自身被拆开。
- `report.json` 的图题/表题段落记录会追加 `pagination` 字段，便于确认分页控制是否生效。
- 网页主界面会显示当前基础模板，并提示未明确说明的格式会继承基础模板。

## V2.5.0 / V0.2 保守式模块触发状态报告

V2.5.0 新增 `module_status`，用于说明本次文档中哪些论文结构模块被高置信度检测到、哪些实际参与处理、哪些未检测到或未明确要求。

保守原则：

- 高置信度识别到的结构才自动处理。
- 未检测到或未明确要求的模块不会强行修改。
- 页眉页脚、页码等当前暂不支持的模块只记录提醒，不自动处理。
- 目录只做保守检测和保护说明，不生成、不更新目录。

`report.json` 和 `final_rules_debug.debug_summary` 中都会写入 `module_status`，网页处理完成区域也会提供“本次检测到的论文结构模块”折叠说明。

## V2.6.0 / V0.3-step1 英文数字字符格式增强基础版

V2.6.0 新增顶层 `latin_digit_format` 规则，用于在老师明确要求时单独设置英文和数字字符的 `ascii` / `hAnsi` 字体及可选字号。

- 仅在出现“英文和数字”“英文字母和阿拉伯数字”“全文英文数字”“正文中英文数字”等明确要求时触发。
- 英文摘要的 Times New Roman 规则不会自动扩大为全文英文数字规则。
- 混合中英文 run 只在纯文本结构中保守拆分，TOC、字段、超链接、公式等复杂结构会保护跳过。
- 中文字体仍由段落样式的 `eastAsia` 字体控制。

## 项目结构

```text
word-format-tool/
├─ format_docx.py
├─ requirements.txt
├─ README.md
├─ templates/
│  ├─ default.json
│  └─ course_paper.json
├─ overrides/
│  └─ teacher_override.json
├─ schemas/
│  └─ format_rules.schema.json
├─ reports/
│  └─ report.json
├─ samples/
│  ├─ input.docx
│  └─ output.docx
├─ tests/
│  └─ test_core.py
└─ web/
   ├─ package.json
   ├─ .env.example
   ├─ app/
   │  ├─ page.tsx
   │  └─ api/
   └─ tmp/
      ├─ jobs/
      └─ parse-jobs/
```

`reports/` 不需要手动创建。使用 `--report reports/report.json` 时，程序会自动创建目录。

`web/tmp/jobs/` 是本地网页版的临时任务目录。它会保存用户上传的 `input.docx`、处理后的 `output.docx` 和 `report.json`。`web/tmp/parse-jobs/` 保存自然语言解析阶段生成的临时 `override.json` 和 `final_rules.json`。开发测试期间可以手动删除，后续版本可以增加自动清理机制。

## V2.0 本地网页版

进入 Web 项目：

```bash
cd web
npm install
npm run dev
```

然后打开：

```text
http://localhost:3000
```

使用流程：

1. 上传 `.docx` 文件。
2. 粘贴老师自然语言格式要求。
3. 点击“解析格式要求”，检查识别结果。
4. 可选：展开“高级设置”，切换基础模板或上传 override JSON 文件。
5. 点击“开始处理”。
6. 页面显示处理成功、统计摘要、warnings 和覆盖字段摘要。
7. 点击“下载修改后的 Word”。

如果系统中 `python` 命令不可用，可以设置 `PYTHON_CMD`。

Windows PowerShell 示例：

```powershell
$env:PYTHON_CMD="python"
npm run dev
```

如果你的环境使用 `py` 启动 Python：

```powershell
$env:PYTHON_CMD="py"
npm run dev
```

如果网页提示缺少 `python-docx`，请先在项目根目录安装 Python 依赖，然后重启网页服务：

```powershell
python -m pip install -r requirements.txt
cd web
npm run dev
```

如果是在 `web` 文件夹里操作，也可以运行：

```powershell
python -m pip install -r ..\requirements.txt
```

网页版本的限制：

- 只支持 `.docx`，不支持 `.doc`。
- 单个文件最大 10MB。
- 文本框中的老师格式要求最大 5000 字，会由服务端调用 Kimi 或 mock 解析为 override JSON。
- 高级上传的自定义覆盖规则只支持 `.json`，最大 1MB。
- 需要本机已安装 Python 和 `python-docx`。
- 建议先确认命令行版工具能跑通。

## 安装依赖

```bash
cd word-format-tool
pip install -r requirements.txt
```

也可以先创建虚拟环境：

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

## 基本运行

不指定模板时，默认使用 `templates/default.json`：

```bash
python format_docx.py samples/input.docx samples/output.docx
```

如果 `samples/output.docx` 已经存在，V1.4 默认不会覆盖，会提示添加 `--overwrite`。

允许覆盖：

```bash
python format_docx.py samples/input.docx samples/output.docx --overwrite
```

## 指定模板

```bash
python format_docx.py samples/input.docx samples/output.docx --template default --overwrite
python format_docx.py samples/input.docx samples/output.docx --template course_paper --overwrite
python format_docx.py samples/input.docx samples/output.docx --template templates/default.json --overwrite
```

## 使用自定义覆盖规则

`--override` 用于指定局部覆盖规则。覆盖文件可以只写一部分字段：

```bash
python format_docx.py samples/input.docx samples/output.docx --template default --override overrides/teacher_override.json --report reports/report.json --overwrite
```

例如 override 只写 `styles.body.font` 和 `styles.body.size_cn`，其他正文行距、缩进、段前段后会继承基础模板。

导出最终完整规则：

```bash
python format_docx.py samples/input.docx samples/output.docx --template default --override overrides/teacher_override.json --export-final-rules reports/final_rules.json --report reports/report.json --overwrite
```

只合并规则、不处理 Word：

```bash
python format_docx.py --template default --override overrides/teacher_override.json --export-final-rules reports/final_rules.json --merge-rules
```

## 生成格式处理报告

```bash
python format_docx.py samples/input.docx samples/output.docx --template default --report reports/report.json --overwrite
```

成功后会输出类似：

```text
格式修改完成：samples/output.docx
使用模板：default
模板说明：通用默认模板
报告文件：reports/report.json
提示：已覆盖已有输出文件。

处理统计：
- 论文标题：1
- 一级标题：1
- 二级标题：2
- 三级标题：1
- 正文段落：6
- 表题：1
- 图题：1
- 摘要相关段落：2
- 关键词段落：1
- 参考文献：3
- 表格：1
- 使用默认 body 回退次数：0
- 警告数量：2
```

如果不传 `--report`，程序只生成 `output.docx`，不会生成报告文件，但命令行仍会输出简要统计。

## report.json 包含什么

报告文件包含：

- `version`：工具版本。
- `input_file`：输入文件路径。
- `output_file`：输出文件路径。
- `template`：模板名称和说明。
- `base_template`：基础模板信息。
- `override`：是否启用自定义覆盖、覆盖文件路径、覆盖字段列表和 override warning。
- `final_rules`：最终合并后的规则名称和说明。
- `stats`：各类段落数量、表格数量、样式回退次数、警告数量。
- `paragraphs`：每个非空普通段落的识别记录。
- `tables`：每个表格的处理记录。
- `template_warnings`：模板规范化或校验过程中产生的 warning。
- `warnings`：潜在误判或样式回退提示。

段落记录示例：

```json
{
  "index": 0,
  "text_preview": "基于规则识别的 Word 论文格式自动化工具设计",
  "detected_type": "paper_title",
  "applied_style": "paper_title",
  "warning": null
}
```

`text_preview` 最多保留前 50 个字符，不会把整篇论文完整写入报告。

## 如何检查识别是否正确

打开 `reports/report.json`，重点看 `paragraphs`：

- `detected_type` 表示程序把该段识别成了什么类型。
- `applied_style` 表示实际使用了模板里的哪个样式。
- `warning` 如果不是 `null`，说明这段可能需要人工确认。

`warnings` 是规则识别风险提示，不代表一定有错误。当前会提示：

- 段落以数字编号开头，但长度超过 40 个字符，因此按正文处理。
- 段落以 `一、`、`二、`、`三、` 等中文编号开头，但长度超过 40 个字符。
- 图题或表题长度超过 50 个字符，提醒人工确认。
- 模板中缺少某个段落类型样式，已回退到 `body`。
- 模板中 `size_cn` 和 `size_pt` 不一致、包含未知样式类型或非标准字段。
- 文档中没有检测到任何有效非空段落。

## 模板放在哪里

模板文件放在 `templates/` 目录下。

当前内置：

- `templates/default.json`：通用默认模板。
- `templates/course_paper.json`：课程论文模板示例。

模板标准说明文件放在 `schemas/format_rules.schema.json`。

自定义覆盖示例放在 `overrides/teacher_override.json`。override 文件可以缺少 `page`，也可以不包含 `styles.body`，因为它只是局部覆盖规则。

## 如何新增自己的模板

复制一份现有模板：

```bash
copy templates\default.json templates\my_school.json
```

然后修改里面的字体、字号、边距和段落间距。

修改后建议先校验：

```bash
python format_docx.py --validate-template templates/my_school.json
```

运行时指定：

```bash
python format_docx.py samples/input.docx samples/output.docx --template my_school --overwrite
```

或者：

```bash
python format_docx.py samples/input.docx samples/output.docx --template templates/my_school.json --overwrite
```

## JSON 模板字段说明

模板顶层字段：

- `version`：格式规则版本，例如 `1.0`。
- `name`：模板名称，用于命令行报告。
- `description`：模板说明，用于命令行报告。
- `page`：页面设置。
- `styles`：各段落类型的格式设置。
- `latin_digit_format`：可选的英文和数字字符格式设置。

`page` 支持：

- `top_margin_cm`：上边距，单位 cm，数字。
- `bottom_margin_cm`：下边距，单位 cm，数字。
- `left_margin_cm`：左边距，单位 cm，数字。
- `right_margin_cm`：右边距，单位 cm，数字。

每个 `styles` 样式支持：

- `font`：字体，字符串，例如 `宋体`、`黑体`。
- `size_pt`：字号，数字，单位磅，例如 12、14、16。
- `size_cn`：中文字号，例如 `小四`、`五号`；程序会规范化成 `size_pt`。
- `bold`：是否加粗，布尔值 `true` 或 `false`。
- `italic`：是否斜体，布尔值 `true` 或 `false`，可选。
- `alignment`：对齐方式，可以是 `left`、`center`、`right`、`justify`，也支持 `居中`、`两端对齐` 等常见中文写法。
- `line_spacing`：行距，数字，例如 1.0、1.5；也支持 `1.5倍`、`单倍行距`。
- `first_line_indent_pt`：首行缩进，数字，单位磅；也支持 `2字符`、`不缩进`。
- `space_before_pt`：段前间距，数字，单位磅。
- `space_after_pt`：段后间距，数字，单位磅。

`styles.body` 是必需字段。如果其他段落类型样式缺失，程序会回退到 `body`，并输出 warning。

`latin_digit_format` 支持 `font`、`size_pt`、`size_cn` 和 `scope`。`scope` 当前可选 `global` 或 `body`；未单独给出字号时只覆盖英文和数字字符的字体。

如果同时写了 `size_cn` 和 `size_pt`，程序优先使用 `size_pt`。如果两者不一致，会生成模板 warning，并写入 `report.json` 的 `template_warnings`。

## 当前支持的段落类型

- `paper_title`：论文标题。
- `abstract_title`：摘要标题。
- `abstract_content`：摘要正文。
- `keywords`：关键词。
- `heading_1`：一级标题。
- `heading_2`：二级标题。
- `heading_3`：三级标题。
- `table_caption`：表题。
- `figure_caption`：图题。
- `body`：普通正文。
- `reference_title`：参考文献标题。
- `reference_item`：参考文献条目。
- `empty`：空段落。
- `table_text`：表格文字。

## 当前识别规则概览

- 第一段非空文本识别为论文标题，但“摘要”“关键词”“目录”“参考文献”等不会被当作论文标题。
- `摘要`、`摘要：`、`摘要:` 识别为摘要标题。
- `摘要：本文...` 识别为摘要正文。
- `关键词：...` 或 `关键词:...` 识别为关键词。
- `参考文献`、`参考文献：`、`参考文献:` 识别为参考文献标题。
- 进入参考文献区域后，后续非空段落默认识别为参考文献条目。
- `表1 xxx`、`表 1 xxx`、`表1-1 xxx` 识别为表题。
- `图1 xxx`、`图 1 xxx`、`图1-1 xxx` 识别为图题。
- `一、研究背景` 这类识别为一级标题。
- `（一）研究意义`、`(一) 研究意义` 这类识别为二级标题。
- `1 绪论`、`1. 绪论` 识别为一级标题。
- `1.1 国内研究现状` 识别为二级标题。
- `1.1.1 技术路线` 识别为三级标题。

## V1.4 错误处理

V1.4 默认不向普通用户显示 Python traceback，而是输出中文错误提示。

如需开发调试信息，可以加：

```bash
python format_docx.py samples/input.docx samples/output.docx --debug
```

常见错误和处理方法：

- 输入文件不存在：检查路径是否写对。
- 文件不是 `.docx`：当前只支持 `.docx`，不支持 `.doc`、`.pdf`。
- 输入是 `.doc`：请先用 Word/WPS 另存为 `.docx` 后再运行。
- 输出文件已存在：添加 `--overwrite`，或换一个输出文件名。
- 输入输出路径相同：换一个输出路径，程序不会覆盖原始文件。
- Word 文件无法打开：确认它是有效 `.docx`，并且没有被 Word/WPS 占用。
- 保存失败：确认目标文件没有被 Word/WPS 打开，并且当前目录有写入权限。
- 模板 JSON 格式错误：检查逗号、引号、括号是否正确。
- 模板字段类型错误：例如 `size_pt` 应为数字，`bold` 应为布尔值，`alignment` 只能是指定值。
- 模板规范化失败：例如未知中文字号、无法识别的行距或缩进写法。

## 运行测试

项目包含基础 unittest 测试：

```bash
python -m unittest
```

测试覆盖段落识别、图题/表题识别、模板读取、模板规范化、模板校验命令、输入输出路径校验、文本预览截断、报告保存，以及不传 `--report` 的旧流程。

## 当前暂不支持

- 自动目录。
- 页眉页脚。
- 复杂页码。
- 参考文献国标自动校验。
- AI 自动理解论文结构。
- GUI 窗口。
- 公网部署。
- 登录系统。
- 数据库。
- 在线 Word 编辑器。

## 后续可升级方向

- 网页端更完整的可视化报告。
- 临时任务自动清理。
- 可视化模板编辑器。
- 格式检查报告。
- 多学校模板库。
- 更细的参考文献格式校验。

## 注意事项

- 输入文件必须是 `.docx`。
- 输出文件必须是 `.docx`。
- 默认不会覆盖已有输出文件。
- 输出文件不能和输入文件相同，避免覆盖原始文档。
- 中文字体会同时写入 `eastAsia`，避免只设置 `run.font.name` 导致中文字体不生效。
