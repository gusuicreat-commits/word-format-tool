# 论格 · Word 论文格式修改器

把老师给的格式要求粘贴进来，上传论文，核对后下载修改后的 Word。

论格帮你处理字体、字号、行距、缩进等重复排版工作。它不是论文代写工具，也不会替你判断论文内容是否正确。

**当前是本地运行、单机常驻服务的试用版，不是已经完成公网验收的在线服务。生成文件后，请用 Word 或 WPS 检查最终版式。**

## 怎么使用

### 1. 上传论文，填写要求

- 支持 `.docx` 文件，最大 10 MB；旧版 `.doc` 请先另存为 `.docx`。
- 在“格式要求”中粘贴老师的要求，最多约 5000 字符。
- 不填写的部分使用后台默认格式，无需选择模板。
- 点击“下一步”，等待系统理解要求和分析文档。

可以先用仓库中的 [示例论文](samples/input.docx) 测试，要求例如：

```text
正文宋体小四，1.5倍行距，首行缩进2字符。
一级标题黑体三号，加粗。
```

### 2. 核对，然后确认修改

查看“确认格式”中的字体、字号等结果，以及需要核对的文档结构。结构分析用来区分标题、正文、参考文献等，避免把标题当正文处理。

默认重点展示有疑问或受保护的内容，需要时可以展开“查看全部结构”。识别错了就先调整；要求写错了，可以展开“修改格式要求”，修改后点击“重新分析”。

“保留原格式”表示该内容不主动套用新的格式，适合封面、复杂表格等特殊部分。但周围文字重新排版后，它在页面上的位置仍可能变化，不是把整页锁死。

核对完毕，勾选“我已确认格式要求和需核对的内容”，再点击下方的“确认并修改 Word”。

### 3. 下载并检查

点击“下载修改后的 Word”，查看“需要注意的地方”。重点检查标题层级、分页、图表和参考文献。

系统生成一份新文件，不会覆盖你电脑上的原始论文。建议保留原稿，确认新文件无误后再提交。

## 能做什么，不能保证什么

| 内容 | 当前能力 |
| --- | --- |
| 标题、正文 | 常见标题层级识别，字体、字号、加粗、对齐、行距、缩进、段前段后等 |
| 摘要、关键词、参考文献 | 支持常见结构及部分细分格式，识别结果需要核对 |
| 图题、表题、页边距 | 支持已识别内容的基础格式及页面边距；保护特殊版面时可能不应用部分要求 |
| 表格、图片、特殊内容 | 保守保护；不保证自动修好宽表、浮动图片重叠或复杂分页 |
| 页眉页脚、页码、自动目录 | 不支持完整自动生成或修改，相关要求可能提示人工处理 |
| 公式、脚注尾注、三线表 | 不支持完整自动排版 |
| 论文内容 | 不负责改写、查重、事实核验或学术合规审查 |

**“解析成功”表示得到了格式规则，不表示所有要求都能执行；“Word 已生成”也不表示整篇已经通过视觉验收。**

## 文件和隐私

- 文件由运行本服务的电脑或服务器处理。自己本地运行时是在自己的电脑上；别人部署的网站则是在对方服务器上。
- 简单要求可在本地解析；复杂要求可能发送给配置的第三方 AI。当前实现不把上传的 Word 文件发送给 AI，但请勿在格式要求里填写敏感信息。
- 同一浏览器会话可在刷新后恢复任务。清除 Cookie、换浏览器或换设备后，不能保证访问原任务；下载链接不是分享链接。
- 文件访问通常在两小时后到期，成功分析或生成结果后会刷新期限，以网页显示为准。
- 网页任务系统初始化后，服务会定期清理过期文件；停机期间不执行清理。直接调用旧接口的清理边界见 [部署说明](DEPLOYMENT.md)。
- 可用“删除文件并重新开始”主动删除任务及关联结果。处理中暂不能删除，已下载到电脑的副本不会被删除。

## 在自己的电脑上运行

已经有人替你启动服务时，只需打开对方提供的网址。以下内容供需要自行安装的人使用。

### 首次安装（Windows PowerShell）

先安装 Git、Node.js 22 或更新的受支持版本（含 npm）、Python 3.10 或更新版本。以下命令在 PowerShell 中逐段执行：

```powershell
git clone https://github.com/gusuicreat-commits/word-format-tool.git
cd word-format-tool
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
$env:PYTHON_CMD = (Resolve-Path .\.venv\Scripts\python.exe).Path
cd web
npm ci
npm run build
npm run start -- --hostname 127.0.0.1 --port 3001
```

打开 [http://127.0.0.1:3001](http://127.0.0.1:3001)。保持终端运行；按 `Ctrl+C` 会停止服务。核心处理不要求安装 Microsoft Word，但查看最终版式需要 Word 或 WPS 等阅读软件。

macOS / Linux 的虚拟环境解释器路径为 `.venv/bin/python`，环境变量语法也不同；上述命令专为 PowerShell 编写。

### 下次怎么启动

在项目根目录打开 PowerShell，执行：

```powershell
$env:PYTHON_CMD = (Resolve-Path .\.venv\Scripts\python.exe).Path
cd web
npm run start -- --hostname 127.0.0.1 --port 3001
```

首次安装、更新代码后需要先运行 `npm run build`。只修改服务端配置时需要重启服务。

需要进程退出后自动重启时，可在项目根目录运行：

```powershell
$env:PYTHON_CMD = (Resolve-Path .\.venv\Scripts\python.exe).Path
.\tools\serve_web.ps1 -NodePath (Get-Command node.exe).Source -Port 3001
```

这个脚本不是开机自启服务，也无法在关闭终端或关机后继续工作。不要同时运行两份服务；已由后台脚本管理时，先停止旧脚本及其服务再启动。如果系统限制脚本执行，可先用上面的 `npm run start` 启动，不必修改全局执行策略。

### 可选：启用 AI 理解复杂要求

简单要求无需密钥。在 `web` 目录创建 `.env.local`，参考 [配置示例](web/.env.example)，但不要覆盖已有配置：

```dotenv
KIMI_API_KEY=填入你自己的API密钥
KIMI_BASE_URL=https://api.moonshot.cn/v1
KIMI_MODEL=填入该账号实际可用的模型名
ENABLE_KIMI_MOCK=false
```

接口地址必须与密钥所属平台对应。当前项目已验证过 `kimi-k2.6` 的非思考解析，但模型可用性、价格和限额以你的服务商账号为准。DeepSeek 尚未完成本项目接入验收，不应视为已支持。

AI 请求可能收费。当前尚未补齐模型调用的全局限速和自动退避重试，复杂要求多时可能失败，不要直接开放大量用户。

不要把真实密钥写进 README、截图或 Git 提交。`.env.local` 已被 Git 忽略。修改配置后需要重启；不建议靠无限延长超时解决接口问题。

## 常见问题

**本地网址打不开？** 先看启动终端是否还在运行，再按“下次怎么启动”操作。端口被占用时先确认是否已有服务。确需换端口时，把命令中的 `3001` 换成空闲端口，浏览器也使用相同端口。

**提示 Python 不可用或缺少 docx？** 确认完成虚拟环境安装和 `pip install -r requirements.txt`，并在启动网页的同一个终端设置 `PYTHON_CMD`。它应是 Python 可执行文件路径，不是一整段命令。

**要求解析失败？** 检查 AI 地址、密钥、可用模型和余额。限流时稍后重试，别连续点击。没有 AI 配置时可以先用简单、明确的要求测试。

**为什么格式仍不完全符合要求？** 可能是结构识别有误、要求有歧义、功能暂不支持，或为保护复杂版面保留了原格式。查看提醒并核对结构；特殊页和图表请人工调整。

## 开发与验收

自动化回归主要使用本地样例和模拟模型结果，不证明真实 AI 的所有输出都正确，也不等于公网部署验收。

在根目录运行：

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
```

在已设置 `PYTHON_CMD` 的终端进入 `web`，运行：

```powershell
npm run test:parser
npm run test:ui-copy
npm run test:warnings
npm run test:security
npm run test:api
npm run typecheck
```

浏览器回归需要本地服务、Microsoft Edge 及 Playwright。服务运行在 3001 后，在 `web` 的另一个终端执行：

```powershell
npm install --no-save --package-lock=false playwright
npm run test:browser
```

测试使用仓库示例及独立会话，覆盖桌面/手机尺寸的上传、确认、刷新恢复、下载、跨会话访问和删除。截图在 `reports/`，不提交到 Git。测试地址可通过 `TEST_API_BASE_URL` 修改。

主要代码：`web/app/page.tsx` 是使用流程，`web/lib/tasks.ts` 管理任务，`web/lib/kimi.ts` 解析要求，`format_docx.py` 执行格式修改，`document_structure.py` 与 `review_workflow.py` 负责结构和确认计划。

准备部署给其他人前，请阅读 [部署约束](DEPLOYMENT.md)。当前只适合单个常驻 Node 进程和持久磁盘；匿名会话不是账号认证，应用限流不足以防止公网滥用。HTTPS、代理上传限制、访问控制、模型额度、费用监控和多人压测仍需单独验收。
