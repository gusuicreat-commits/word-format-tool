# 文格 · Word 论文格式修改器

本地运行的论文排版工具：上传 `.docx`，输入格式要求，检查并确认识别结果，再生成修改后的 Word 和处理报告。

这份 README 是项目的开发总入口，供后续开发者和代码助手使用。**实现行为以代码与测试为准；本文件中的路线图是建议，不代表已经实现。**

- 文档核对日期：2026-09-09。
- 当前代码版本：Python `VERSION = V2.6.0`；Web 包版本 `2.6.0`。这些是代码中的版本标记，不代表当前工作区已经发布。
- 当前定位：本地单用户工具，尚未建设多用户服务、任务队列、登录和权限体系。
- 核心原则：格式要求先转成可检查的规则，再由确定性的 Python 程序修改文档。

## 目录

- [快速运行](#快速运行)
- [功能与边界](#功能与边界)
- [架构与代码地图](#架构与代码地图)
- [接口与任务文件](#接口与任务文件)
- [规则与模板](#规则与模板)
- [后续开发方法](#后续开发方法)
- [测试与验收](#测试与验收)
- [排障与数据管理](#排障与数据管理)
- [开发路线图](#开发路线图)

## 快速运行

### 环境准备

建议使用 Node.js 22 LTS、npm 和 Python 3.10+。这是开发环境建议，不是已完成跨版本兼容测试的承诺。Python 源码使用了 `str | None` 等类型语法。

前端依赖包括 Next.js 16、React 19、TypeScript、OpenAI SDK 和 Lucide React。具体安装版本以 [web/package-lock.json](web/package-lock.json) 为准。Python 依赖目前只有 [requirements.txt](requirements.txt) 中的 `python-docx`，尚未锁定版本。

以下 PowerShell 命令从仓库根目录执行。推荐为项目单独创建虚拟环境，无需激活：

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -c "import docx; print(docx.__version__)"
$env:PYTHON_CMD = (Resolve-Path .\.venv\Scripts\python.exe).Path
cd web
npm ci
npm run dev -- --hostname 127.0.0.1
```

打开 [http://localhost:3000](http://localhost:3000)。若端口被占用，可加 `--port 3001`，并以终端输出的地址为准。

注意：

- **必须从 `web/` 启动 Next.js。** 接口通过 `process.cwd()` 找临时目录，并用上一级目录定位 Python 脚本和模板。
- `PYTHON_CMD` 应为可执行文件路径，不是 `python -X utf8` 这样的整段命令。
- 换终端后需要重新设置上述环境变量，或在 `web/.env.local` 配置绝对路径。
- 当前根目录忽略规则未包含 `.venv/`；不要提交虚拟环境。可在个人 `.git/info/exclude` 中忽略它，团队采用该约定后再统一修改 `.gitignore`。
- macOS/Linux 对应解释器为 `.venv/bin/python`。跨平台文档排版仍需实际验收。
- 不需要安装 Microsoft Word 才能运行核心处理；最终版式应在目标 Word/WPS 环境中人工检查。

### 可选的 Kimi 配置

简单要求可由本地解析器处理，无需 Kimi Key。复杂要求可能进入 Kimi 分支，届时必须配置有效 Key 和模型名。

首次配置时，若 `web/.env.local` 不存在，可从 [web/.env.example](web/.env.example) 复制；不要覆盖已有配置。示例：

```dotenv
PYTHON_CMD=C:/projects/word-format-tool/.venv/Scripts/python.exe
KIMI_API_KEY=替换为自己的密钥
KIMI_BASE_URL=https://api.moonshot.ai/v1
KIMI_MODEL=替换为账户可用的模型标识
ENABLE_KIMI_MOCK=false
```

其他可选参数：

| 参数 | 当前默认值 | 用途 |
| --- | --- | --- |
| `KIMI_TIMEOUT_MS` | `100000` | 服务端模型调用超时时间，毫秒 |
| `KIMI_MAX_TOKENS` | `6000` | 模型输出 token 上限 |
| `ENABLE_KIMI_MOCK` | 仅字符串 `true` 启用 | 用模拟解析结果测试流程 |

Mock 分支优先于本地/自动模式选择，不能用它证明真实模型解析正确。修改配置后重启服务；解析缓存也会随进程重启清空。

**数据边界：** 进入 Kimi 分支时，格式要求文本会发送到配置的模型服务。当前代码不会将上传的 Word 文件发送给 Kimi，文件由本机 Node.js/Python 处理。不要将“本地运行”解释为所有输入都绝不出网。

### 基本使用

1. 选择或拖入 Word 文件，只支持 `.docx`，最大 10 MiB。
2. 可选：粘贴格式要求，最多 5000 个 JavaScript 字符长度单位。
3. 有格式要求时先解析，检查规则、默认模板和提醒。
4. 勾选规则确认；有冲突提醒时还需要确认冲突。
5. 开始处理，下载生成的 `formatted-paper.docx`。
6. 查看报告，并在 Word/WPS 中检查分页、图表和暂不支持的内容。

没有输入格式要求时，可以直接按选定基础模板处理。修改要求或切换模板后，旧识别结果与确认状态会失效，需要重新解析。

### 生产模式本地运行

在 `web/` 执行：

```powershell
npm run build
npm run start -- --hostname 127.0.0.1
```

这仅代表使用 Next.js 生产构建运行，不代表已经具备公网部署条件。部署环境必须同时支持 Node.js、Python、`python-docx`、可写任务目录和子进程；纯静态托管不适用。不要在同一工作目录并行运行构建和开发服务，避免 `.next` 产物相互影响。

## 功能与边界

| 模块 | 当前行为与边界 |
| --- | --- |
| 上传与确认 | 点击、拖拽、更换、移除；前后端检查文件扩展名与大小；规则及冲突确认 |
| 标题与正文 | 论文标题、三级标题、字体字号、行距、缩进、对齐、段前段后等；结合样式和常见编号识别 |
| 摘要与关键词 | 中英文摘要；关键词标签与内容的细分样式；兼容旧样式键 |
| 英文和数字 | 支持正文、参考文献中相应片段的独立字体设置；复杂结构保守处理 |
| 参考文献 | 标题、条目、悬挂缩进及英文数字格式 |
| 图题与表题 | 基础样式、部分分页控制；不等于完整识别图文对应关系 |
| 页面设置 | 页边距等已支持字段 |
| 表格 | 单元格基础文字样式、部分分页与跨页行控制；复杂表格仍需人工检查 |
| 目录与编号 | 保护目录和编号结构是重点；部分图表、表格处理分支会清理编号，不能承诺所有编号完全不变 |
| 页眉页脚、页码 | 检测、报告提醒，不自动生成或修改 |
| 三线表、公式、脚注尾注 | 不具备完整自动处理能力；解析层会对部分要求标记不支持 |
| 双面打印、装订、目录生成 | 不应作为已完成的自动排版能力对外承诺 |

文字统一黑色、清理下划线等行为受规则与执行分支影响，扩展时应检查具体作用范围。项目处理的是排版，不是论文内容改写、校对或学术规范审查。

## 架构与代码地图

```text
浏览器
  -> /api/templates                        读取基础模板
  -> /api/parse-requirements
       -> 复杂度判断
       -> 本地解析 / Kimi规范化清单 / Mock
       -> 规范化、校验、冲突与不支持项标记
       -> Python --merge-rules             合并并校验最终规则
       -> 返回规则摘要与调试信息
  -> 用户确认
  -> /api/format
       -> 保存独立任务文件
       -> Python format_docx.py            识别结构并应用规则
       -> output.docx + report.json
  -> /api/download/{jobId}                 下载生成文件
```

**即使只点击“解析格式要求”，后端仍需要调用 Python 合并规则。** 不要只验证模型接口或前端就判断整个解析链路可用。

| 路径 | 职责 / 从这里开始看 |
| --- | --- |
| [web/app/page.tsx](web/app/page.tsx) | 主流程、上传状态、解析与处理请求、确认门槛、报告 UI |
| [web/app/globals.css](web/app/globals.css) | 配色、布局、响应式、上传区及结果展示 |
| [web/app/flowing-rings.tsx](web/app/flowing-rings.tsx) | Canvas 文字环；离屏图层缓存、平滑运动、可见性与减少动态效果支持 |
| [web/app/api/parse-requirements/route.ts](web/app/api/parse-requirements/route.ts) | 解析编排、缓存、Python 合并、响应 |
| [web/lib/kimi.ts](web/lib/kimi.ts) | 本地解析、模型调用、规范化清单解析、规则规范化、校验、冲突检查 |
| [web/lib/requirements.ts](web/lib/requirements.ts) | 覆盖字段收集、规则摘要和预览 |
| [web/lib/python.ts](web/lib/python.ts) | 解析阶段 Python 子进程调用与错误提取 |
| [web/app/api/format/route.ts](web/app/api/format/route.ts) | 上传处理、执行 Python、读取报告；目前另有一套子进程辅助代码 |
| [web/app/api/download/[jobId]/route.ts](web/app/api/download/[jobId]/route.ts) | 任务 ID 校验与文件下载 |
| [web/app/api/templates/route.ts](web/app/api/templates/route.ts) | 枚举模板 JSON，跳过损坏文件 |
| [format_docx.py](format_docx.py) | CLI、模板校验合并、文档识别、排版、报告、安全保存 |
| [schemas/format_rules.schema.json](schemas/format_rules.schema.json) | 规则结构定义 |
| [templates/default.json](templates/default.json) | 通用论文模板 |
| [templates/course_paper.json](templates/course_paper.json) | 课程论文模板 |
| [overrides/teacher_override.json](overrides/teacher_override.json) | 局部覆盖示例 |
| [tests/test_core.py](tests/test_core.py) | Python 回归测试 |
| [web/tests/local-parser.test.js](web/tests/local-parser.test.js) | 本地解析与相关规则逻辑测试 |
| [web/tests/ui-copy.test.js](web/tests/ui-copy.test.js) | 源码级文案/关键约束断言，不是浏览器端到端测试 |

`samples/` 放本地测试材料，不应假设每个样例都随仓库分发。`rendered/` 和 `design-qa.md` 是阶段性视觉检查材料，不能代替当前版本的验收。

### Python 核心阅读顺序

1. `parse_args()`、`main()`：CLI 入口和错误处理。
2. `prepare_template()`、`normalize_override_rules()`、`get_final_format_rules()`：规则来源。
3. `merge_format_rules()`：字段合并、兼容处理、元数据。
4. `detect_paragraph_type()`、`detect_text_heading_type()`：结构识别。
5. `apply_paragraph_style()`、`apply_run_font()`：实际应用格式。
6. `format_normal_paragraphs()`、`format_tables()`：文档遍历。
7. `finalize_module_status()`、`safe_save_document()`：报告和保存。

## 接口与任务文件

所有接口目前运行于 Next.js Node.js runtime，同源调用，没有独立后端 HTTP 服务。

| 接口 | 输入 | 主要输出 |
| --- | --- | --- |
| `GET /api/templates` | 无 | `success`、`templates[]` |
| `POST /api/parse-requirements` | JSON：`requirementsText`、`template`、`forceMode` | `mode`、`normalizedOverride`、`summary`、`warnings`、`finalRules`、`cached` 等 |
| `POST /api/format` | multipart：`file`、`template`；可选 `overrideText` 或 `override` 文件 | `jobId`、`downloadUrl`、`report`、`notices` |
| `GET /api/download/{jobId}` | 格式化任务 ID | Word 二进制；不存在时返回 404 |

解析请求示例：

```json
{
  "requirementsText": "正文宋体小四，1.5倍行距，首行缩进2字符。",
  "template": "default",
  "forceMode": "local"
}
```

- `forceMode` 仅 `local` 强制本地识别，其余值按 `auto` 处理；Mock 开启时优先进入 Mock。
- 实际主路径模式为 `local`、`kimi_canonical`、`mock_canonical`；前端类型仍保留部分旧模式兼容。
- 解析成功后，页面优先取 `normalizedOverride`；提交处理时将它作为 JSON 字符串放进 `overrideText`。
- `overrideText` 最大 50 KiB；上传覆盖 JSON 最大 1 MiB；两者同时存在时文本优先。
- 解析任务 ID 与格式化任务 ID 是两次独立生成的 ID，不能混用下载地址。
- 失败通常返回 `success: false`、`message`，部分接口有 `errorCode` 和恢复操作；调用方应兼容字段缺失。
- 前端确认是交互门槛，当前 `/api/format` 不接收或验证“用户已确认”凭据。未来多用户化不能把 UI 勾选视为服务端权限校验。

运行产物：

```text
web/tmp/
  parse-jobs/<解析任务ID>/
    override.json
    final_rules.json
    debug_rules.json
  jobs/<格式化任务ID>/
    input.docx
    output.docx
    report.json
    override.json              # 使用覆盖规则时生成
```

解析缓存是进程内 `Map`，上限 50 条，键由模板名、模式及规范化要求文本的哈希组成。重启会丢失；它没有跨进程共享或持久化，也不包含模板文件内容版本。修改模板或解析逻辑后，开发时应重启以排除旧缓存。

## 规则与模板

### 三种对象不要混淆

- **基础模板**：完整默认规则，缺省字段可能由 Python 规范化补齐。
- **局部覆盖 override**：只表达明确要求修改的字段；不应擅自填入无关默认值。
- **最终规则 final rules**：基础模板与覆盖经过 Python 合并、规范化、校验后的执行规则。

`page` 和 `styles` 等按对应分支合并；`toc`、元数据、不支持模块有专门逻辑，不能用通用浅合并替代 `merge_format_rules()`。

局部覆盖示例：

```json
{
  "name": "body_override",
  "description": "仅调整正文字号和行距",
  "styles": {
    "body": {
      "size_pt": 12,
      "line_spacing": 1.5
    }
  }
}
```

这里没有指定字体、页边距或标题，其他字段应继承模板。完整模板 schema 和局部覆盖校验规则不同，不要要求 override 具备所有完整模板必填字段。

### 字段约定

- 页面边距 `*_cm` 为厘米；字号、部分缩进和间距 `*_pt` 为磅。
- `size_cn` 等友好输入需要规范化，不要原样传入底层格式操作。
- 字符缩进、磅缩进、悬挂缩进之间有专门转换规则；不要仅改字段名。
- 行距倍数与固定值、段前段后“行数”与“磅数”不能混用。
- 旧的 `abstract_title`、`abstract_content`、`keywords` 与细分中英文样式存在兼容逻辑，修改时必须保留回归覆盖。
- `module_status` 是 Python 报告字段，Web 响应转换为 `moduleStatus`；新增字段应同步映射和前端显示。

### CLI 调试

从仓库根目录执行，以下 `python` 要替换为安装了依赖的解释器：

```powershell
python format_docx.py --help
python format_docx.py --validate-template templates/default.json
python format_docx.py --validate-template templates/course_paper.json
python format_docx.py --template default --override overrides/teacher_override.json --merge-rules --export-final-rules reports/final_rules.json --export-debug-rules reports/debug_rules.json
python format_docx.py samples/input.docx samples/output.docx --template default --override overrides/teacher_override.json --report reports/report.json
```

最后一条需要先准备 `samples/input.docx`。默认不允许覆盖已存在的输出；仅在确认目标可覆盖时添加 `--overwrite`。使用 `--debug` 获取 traceback。不要用唯一一份真实论文进行破坏性排查。

## 后续开发方法

### 开发约定

1. 改动前阅读相关模块、测试和当前 Git diff，保留他人未提交的修改。
2. 一次变更围绕一个行为问题，先建立可复现输入和预期。
3. 缺陷尽量先在最小样例复现，再修解析、合并或执行中真正出错的层。
4. 新字段必须贯通识别、规范化、校验、合并、执行、摘要和报告，不能只增加模型提示词。
5. 遇到不支持或不确定的结构，应提供提醒或明确跳过，不要把“检测到”展示为“已修改”。
6. 修改完成后运行对应检查，记录真实验证结果和未验证项，再更新文档。

### 新增格式字段

核对以下受影响面：

- `schemas/format_rules.schema.json` 的字段声明。
- `web/lib/kimi.ts` 的本地解析、规范化清单映射、规范化与校验。
- `format_docx.py` 的允许字段、规范化、校验及具体执行函数。
- `web/lib/requirements.ts` 的摘要和字段展示。
- `page.tsx`、接口映射和报告字段（如需要）。
- 正常输入、错误输入、缺省继承、冲突、旧模板兼容的回归测试。

模型输出始终作为待校验数据；不能把自然语言或模型输出拼成 shell 命令。

### 新增学校模板

1. 从现有模板复制为 `templates/<name>.json`，保持文件名与 JSON 的 `name` 一致。
2. 使用字母、数字、下划线或短横线作为名称；API 不接受模板路径。
3. 只写当前支持的规则，对来源、适用范围和不支持内容做好说明。
4. 运行模板校验与最小 Word 样例测试。
5. 检查模板列表、切换后旧解析状态失效、规则继承及结果报告。

模板接口会枚举 JSON，但新增模板仍需检查前端显示名称和说明是否合适。

### 前端与视觉维护

当前视觉方向参考 [The Content Architecture](https://www.contentarchitecture.dev/?ref=onepagelove)：米白底色、黑色区块、简洁排版、等宽编号、克制边框。它是视觉参考，不是产品功能或代码依赖。

- 全局样式在 `globals.css`；优先修改现有变量和组件样式，避免重复追加互相覆盖的 CSS。
- 上传控件使用隐藏 input、按钮和拖拽区域；保留键盘操作、文件更换/移除、错误信息和处理中禁用状态。
- 图标使用 Lucide。可复用的产品资源应提交到 `web/public/`，不要笼统忽略所有 PNG。
- 首屏动效在 `flowing-rings.tsx`，当前由 Canvas 绘制，不再依赖原始静态文字环图片。
- 动画修改需检查字距是否跳变、缩放清晰度、手机性能、减少动态效果偏好，以及离开可视区域/隐藏标签页后的暂停。
- 不要让视觉调整绕过规则确认、冲突确认或错误恢复流程。

## 测试与验收

### 自动检查

仓库根目录：

```powershell
python -m unittest
python format_docx.py --validate-template templates/default.json
python format_docx.py --validate-template templates/course_paper.json
```

`web/`：

```powershell
npm run test:parser
npm run test:ui-copy
npm run typecheck
npm run build
```

若 PowerShell 执行策略阻止 `npm.ps1`，使用 `npm.cmd` 调用同一命令，不必修改全局执行策略。

这些检查各有边界：文案测试读取源码做断言；解析测试不等于真实 Kimi 集成；构建通过不等于生成的 Word 版式正确。不要把某次通过的测试数量或截图当作永久质量结论。

### 按改动范围选择验收

| 改动 | 至少检查 |
| --- | --- |
| 仅文档 | 路径、命令、配置名与代码一致；Markdown 链接有效 |
| 前端样式/交互 | 类型检查、相关文案测试；桌面与手机截图；关键操作及控制台 |
| 解析/规则 | 本地解析测试、Python 回归、两份模板校验；完整规则链路样例 |
| Word 执行逻辑 | Python 回归、最小 DOCX 样例、报告、输出结构及目标 Word/WPS 视觉 |
| 接口/依赖 | 相关测试、生产构建、上传到下载的完整流程及失败分支 |

### 端到端人工清单

- 无文件时不可处理；扩展名错误、超过大小限制时提示明确。
- 点击选取、拖拽、更换、移除以及重新选取同一文件均正常。
- 示例要求可以解析；清空/修改要求或切换模板后不会继续使用旧规则。
- 解析失败可重试、改用快速识别或返回编辑。
- 规则未确认、冲突未确认时不能开始修改。
- 处理结果可下载，输出可打开；报告中的“已应用/仅提醒/跳过”与实际一致。
- 输入与输出正文内容、表格、图片、公式、目录和编号无非预期损坏。
- 页面在窄屏和宽屏无横向溢出；动态区域不遮挡操作控件。

涉及复杂 Word 结构时，应检查文档 XML 或保留结构的回归断言；仅看截图不足以证明链接、域、编号和公式结构未损坏。

## 排障与数据管理

| 现象 | 排查入口 |
| --- | --- |
| 页面打不开 | 检查 Next.js 进程、实际端口；在 `web/` 启动 |
| 解析或处理提示缺少 `docx` | 使用 `PYTHON_CMD` 指向的解释器执行 `-m pip install -r requirements.txt`，再验证导入 |
| 找不到脚本或模板 | 检查启动工作目录是否为 `web/`，仓库目录结构是否完整 |
| 复杂要求失败，简单要求成功 | 查看模型配置、错误码、网络或超时；可在 UI 改用快速识别 |
| 改模板后预览未变化 | 重启服务清除进程内解析缓存，再重新解析 |
| 规则看起来正确，输出不正确 | 对照 `debug_rules.json`、最终规则、段落识别结果和 `report.json` 分层定位 |
| 下载 404 | 检查使用的是格式化任务 ID，且对应 `output.docx` 尚未清理 |
| Word 中出现 ¶ 或 ↵ | 先检查是否开启显示编辑标记；不要直接删除文档内容 |
| 表格或图片分页不理想 | 在目标 Word/WPS 人工检查；当前规则不保证复杂版面完全一致 |

### Python 解释器的当前差异

- 解析合并：`web/lib/python.ts` 先选 `PYTHON_CMD`，否则 `python`。
- 文档处理：`/api/format` 先选 `PYTHON_CMD`，否则尝试本机 Codex bundled Python，再选 `python`。
- 两者在无法启动或缺少 `python-docx` 时，都可能尝试已有 bundled Python 回退。
- bundled Python 是环境兼容路径，不是项目依赖保证。常规开发应显式配置同一项目解释器，避免两个阶段使用不同环境。

### 文件与隐私

`web/tmp/` 中会保存原文档、输出、要求及调试信息。当前没有自动过期清理机制；解析缓存淘汰也不会清理磁盘任务目录。

- 清理前先确认任务已结束，输出无需继续下载；删除任务文件后相应下载会失效。
- 不要提交密钥、真实论文、包含敏感内容的报告、虚拟环境或临时产物。
- `reports/`、`web/tmp/`、`node_modules/`、`.next/` 已被忽略；并不是所有 `.docx/.pdf/.png` 或 `rendered/` 都自动忽略，提交前检查 `git status`。
- `next-env.d.ts` 和 `tsconfig.tsbuildinfo` 由工具生成，不应为业务需求手动修改。
- 当前没有鉴权、任务归属验证、并发限制或 Python 子进程执行超时。随机任务 ID 不是权限体系，暂不应直接面向不可信公网用户开放。

## 开发路线图

以下按建议优先级排列；先处理影响结果正确性与可复现性的工作，再扩大排版范围。

| 优先级 | 工作 | 完成标准 |
| --- | --- | --- |
| P0 | 固化上传到下载的集成回归 | 自动覆盖本地解析、默认模板、覆盖规则、失败分支和有效 DOCX 输出 |
| P0 | 建立脱敏 Word 样例集 | 覆盖中英文摘要、关键词、编号、目录、复杂 run、图表与参考文献；有结构/格式预期 |
| P1 | 统一 Python 运行层 | 解析与格式化共用解释器选择、错误码、超时和子进程终止策略 |
| P1 | 改善任务与缓存管理 | 缓存考虑模板/解析版本；任务文件有保留期限；失败任务可诊断、可清理 |
| P1 | 规则契约一致性 | schema、TS/Python 校验、摘要、执行及报告对同一字段有一致语义 |
| P1 | 依赖与环境可复现 | 固定测试环境和 Python 依赖版本；评估依赖审计结果；升级后有回归证据 |
| P2 | 表格与图题表题增强 | 针对合并单元格、分页、图题关联分别实现并测试；三线表单独建能力 |
| P2 | 模板与报告体验 | 模板来源/适用范围明确；展示规则来源、跳过原因和人工检查项 |
| P3 | 页眉页脚和页码 | 先设计分节、首页不同、奇偶页等规则，再逐步实现 |
| P3 | 多用户部署 | 增加鉴权、任务归属、资源限制、队列及文件生命周期后再对外开放 |

### 每次交付前

- 说明实际改变的行为、兼容性影响和仍不支持的部分。
- 核对与本次变更相关的测试及人工验收，不声称运行过未执行的检查。
- 更新涉及的模板、接口说明、能力边界和样例。
- 检查提交列表中的敏感数据、生成文件和无关改动。
- 给下一位开发者留下可复现的问题输入、操作步骤与预期结果。
