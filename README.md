# Word 论文格式修改器

这是一个本地运行的 Word 论文格式修改工具。

用户上传 `.docx` 论文后，把老师给的格式要求粘贴到网页里。系统会先把格式要求识别成可确认的规则，用户确认后，再自动修改 Word 排版，并提供修改后的 Word 下载。

## 当前状态

项目已经可以跑通主要流程：

1. 上传 Word 文件。
2. 粘贴老师的自然语言格式要求。
3. 自动识别格式规则。
4. 在网页上确认识别结果。
5. 按确认后的规则修改 Word。
6. 下载修改后的 Word。
7. 生成处理报告，方便检查哪些地方被处理了，哪些地方只是提醒。

目前正文、标题、关键词、参考文献等常见论文格式已经能处理得比较稳定。表格里的复杂内容还不是重点能力，后面需要单独增强。

## 目前能处理什么

已经支持或基本支持：

- 论文标题格式。
- 中文摘要标题和正文格式。
- 英文摘要标题和正文格式。
- 中文关键词中“关键词：”和后面内容分开设置格式。
- 英文 `Keywords:` 和后面内容分开设置格式。
- 一级、二级、三级标题格式。
- 根据常见编号识别标题层级，例如 `一、`、`1`、`1.1`、`1.1.1`。
- 正文字体、字号、行距、首行缩进、对齐方式。
- 正文里的英文和数字单独设置为 Times New Roman。
- 参考文献标题和条目格式。
- 参考文献里的英文、数字、年份、卷期号、页码单独设置为 Times New Roman。
- 参考文献条目悬挂缩进。
- 页面边距。
- 文字颜色统一为黑色。
- 清除正文中多余下划线。
- 保护目录，不自动生成目录，也不自动更新目录。
- 保护 Word 自动编号结构，尽量不破坏原来的编号。

暂时只提醒、不实际处理：

- 页眉。
- 页脚。
- 页码。
- 双面打印。
- 装订线或侧面装订。
- 自动生成目录或更新目录。

目前支持很有限：

- 表格里的文字和复杂表格格式。
- 三线表。
- 图片。
- 公式。
- 脚注、尾注。

## 基本技术逻辑

这个项目分成三层：

1. 网页层：负责上传 Word、粘贴要求、展示识别结果、确认规则、下载文件。
2. 规则识别层：把老师写的自然语言格式要求，转换成系统能执行的格式规则。
3. Word 修改层：真正打开 `.docx`，按规则修改字体、字号、段落、缩进等格式。

更具体一点：

- 前端使用 Next.js。
- Word 修改核心在 `format_docx.py`。
- Word 文件处理主要使用 `python-docx`。
- 简单格式要求优先走本地解析。
- 复杂格式要求可以走 Kimi 解析。
- Kimi 只负责“读懂老师要求”，不会直接读取或修改 Word 文件。
- 最终修改 Word 的动作仍然由本地 Python 脚本完成。

这样做的好处是：AI 只负责理解要求，真正改文件的部分仍然是可控的本地程序。

## 本地启动方法

先进入你自己电脑上的项目目录。下面只是示例，实际路径按你保存项目的位置来：

```powershell
cd D:\projects\word-format-tool
```

启动网页：

```powershell
cd web
npm run dev
```

然后打开：

```text
http://localhost:3000
```

如果网页打不开，通常是本地开发服务没有运行，重新执行 `npm run dev` 即可。

## Kimi 配置

如果要使用复杂格式要求识别，需要在 `web/.env.local` 中配置 Kimi：

```env
KIMI_API_KEY=你的Kimi API Key
KIMI_BASE_URL=https://api.moonshot.ai/v1
KIMI_MODEL=你的模型名称
ENABLE_KIMI_MOCK=false
```

不要把真实 API Key 提交到 Git。

如果只是本地测试流程，可以临时使用 mock：

```env
ENABLE_KIMI_MOCK=true
```

## Python 路径

网页在点击“开始修改 Word”时，会在后台调用 Python 脚本。

如果系统里的 `python` 命令不可用，可以把 `PYTHON_CMD` 指向你电脑上的 Python 路径。

示例：

```powershell
$env:PYTHON_CMD="D:\Python\python.exe"
```

然后再启动网页：

```powershell
cd web
npm run dev
```

## 使用步骤

1. 打开网页。
2. 上传 `.docx` 论文。
3. 粘贴老师的格式要求。
4. 点击“解析格式要求”。
5. 检查页面识别出来的规则。
6. 勾选确认。
7. 点击“开始修改 Word”。
8. 处理成功后，点击下载修改后的 Word。
9. 打开 Word 人工检查一遍，尤其是表格、图片、页眉页脚、页码等暂未完整支持的部分。

## 常见问题

### 解析成功，但修改 Word 失败

通常要检查：

- 本地网页服务是否还在运行。
- Python 是否能启动。
- 上传的 Word 文件是否还在临时目录中。
- Word 文件是否被 Word/WPS 占用。
- 文件是不是 `.docx`，不是 `.doc` 或 `.pdf`。

页面现在会尽量给出更具体的失败原因。

### 表格里的格式没有完全改好

这是当前项目的已知限制。

正文段落已经比较稳定，但表格内部文字、表格线、三线表、复杂合并单元格等还没有完整处理。遇到这类内容，建议先让工具处理正文，再手动检查表格。

### 页眉、页脚、页码没有自动处理

这是当前故意保守处理的部分。

系统会识别并提醒，但不会自动修改页眉、页脚和页码，避免误改 Word 结构。

## 验证命令

Python 测试：

```powershell
python -m unittest
python format_docx.py --validate-template templates/default.json
python format_docx.py --validate-template templates/course_paper.json
```

如果 `python` 不可用，就把命令里的 `python` 换成实际 Python 路径。

前端测试：

```powershell
cd web
cmd /c npm run test:parser
cmd /c npm run test:ui-copy
cmd /c npm run typecheck
cmd /c npm run build
```

## 临时文件

网页运行时会把上传文件、处理结果和报告放到：

```text
web/tmp/
```

这个目录只是本地临时文件目录，不应该提交到 Git。

以下内容也不应该提交：

- `.env`
- `.env.local`
- `web/.env.local`
- `node_modules/`
- `web/.next/`
- 临时 `.docx`
- 临时 `.pdf`
- 临时 `.png`
- `reports/`

## 项目目录简表

```text
word-format-tool/
├─ format_docx.py                 # Word 修改核心
├─ templates/                     # 内置格式模板
├─ schemas/                       # 格式规则校验
├─ tests/                         # Python 测试
├─ web/                           # Next.js 网页
│  ├─ app/                        # 页面和接口
│  ├─ lib/                        # 格式要求解析逻辑
│  ├─ tests/                      # 前端解析和文案测试
│  └─ tmp/                        # 本地临时文件，不提交
└─ README.md
```

## 后续可以重点完善

- 表格中文字和表格样式处理。
- 三线表。
- 图片和图题关系。
- 公式保护和识别。
- 页眉、页脚、页码的安全处理。
- 更友好的处理报告。
- 更多学校模板。
