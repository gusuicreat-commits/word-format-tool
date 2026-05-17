"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type TemplateItem = {
  name: string;
  description: string;
  displayName?: string;
};

type WarningItem = {
  paragraph_index: number | null;
  text_preview: string;
  message: string;
};

type RuleSummaryItem = {
  type: string;
  label: string;
  description: string;
  fields?: {
    key: string;
    label: string;
    value: string;
  }[];
};

type ParseResult = {
  success: boolean;
  message: string;
  jobId?: string;
  mode?: "kimi" | "mock" | "local";
  override?: unknown;
  rawModelOutput?: string;
  parsedOverride?: unknown;
  normalizedOverride?: unknown;
  finalRules?: unknown;
  debugSummary?: unknown;
  overriddenFields?: string[];
  warnings?: string[];
  summary?: RuleSummaryItem[];
  finalRulesPreview?: unknown;
  cached?: boolean;
};

type ReportSummary = {
  template: {
    name: string;
    description: string;
  };
  baseTemplate?: {
    name?: string;
    description?: string;
    path?: string;
  } | null;
  override?: {
    enabled?: boolean;
    path?: string;
    name?: string;
    description?: string;
    overridden_fields?: string[];
    warnings?: string[];
    warning_count?: number;
  };
  finalRules?: {
    name?: string;
    description?: string;
  } | null;
  stats: Record<string, number>;
  warnings: WarningItem[];
};

type FormatResult = {
  success: boolean;
  jobId?: string;
  message: string;
  downloadUrl?: string;
  notices?: string[];
  report?: ReportSummary;
};

type ParseStatus = "idle" | "parsing" | "success" | "error";
type FormatStatus = "idle" | "processing" | "success" | "error";

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MAX_OVERRIDE_SIZE = 1 * 1024 * 1024;
const MAX_REQUIREMENTS_LENGTH = 5000;

const REQUIREMENTS_EXAMPLE = `论文标题黑体三号居中；
正文宋体小四，1.5倍行距，首行缩进2字符；
一级标题黑体小三；
二级标题黑体四号；
图题和表题宋体五号居中；
参考文献宋体五号。`;

export default function HomePage() {
  const [templates, setTemplates] = useState<TemplateItem[]>([]);
  const [templateName, setTemplateName] = useState("default");
  const [file, setFile] = useState<File | null>(null);
  const [requirementsText, setRequirementsText] = useState("");
  const [parsedOverride, setParsedOverride] = useState<unknown | null>(null);
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const [overrideFile, setOverrideFile] = useState<File | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [parseStatus, setParseStatus] = useState<ParseStatus>("idle");
  const [parseError, setParseError] = useState("");
  const [formatStatus, setFormatStatus] = useState<FormatStatus>("idle");
  const [formatError, setFormatError] = useState("");
  const [result, setResult] = useState<FormatResult | null>(null);
  const [notices, setNotices] = useState<string[]>([]);
  const [isParsing, setIsParsing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    let active = true;

    async function loadTemplates() {
      try {
        const response = await fetch("/api/templates");
        const data = (await response.json()) as {
          success: boolean;
          templates?: TemplateItem[];
          message?: string;
        };

        if (!active) {
          return;
        }

        if (!data.success) {
          setFormatError(data.message || "模板列表读取失败。");
          return;
        }

        const nextTemplates = data.templates || [];
        setTemplates(nextTemplates);
        setTemplateName(
          nextTemplates.find((template) => template.name === "default")?.name ||
            nextTemplates[0]?.name ||
            "default",
        );
      } catch {
        if (active) {
          setFormatError("模板列表读取失败，请确认本地服务正在运行。");
        }
      }
    }

    loadTemplates();
    return () => {
      active = false;
    };
  }, []);

  const canSubmit = useMemo(() => {
    return Boolean(file && templateName && !isSubmitting && !isParsing);
  }, [file, templateName, isSubmitting, isParsing]);

  function resetFormatFeedback() {
    setResult(null);
    setNotices([]);
    setFormatError("");
    setFormatStatus("idle");
  }

  function handleFileChange(nextFile: File | null) {
    resetFormatFeedback();

    if (!nextFile) {
      setFile(null);
      return;
    }

    if (!nextFile.name.toLowerCase().endsWith(".docx")) {
      setFile(null);
      setFormatError("只能上传 .docx 文件。");
      setFormatStatus("error");
      return;
    }

    if (nextFile.size > MAX_FILE_SIZE) {
      setFile(null);
      setFormatError("Word 文件不能超过 10MB。");
      setFormatStatus("error");
      return;
    }

    setFile(nextFile);
  }

  function handleRequirementsChange(nextValue: string) {
    setRequirementsText(nextValue);
    setParsedOverride(null);
    setParseResult(null);
    setParseError("");
    setParseStatus("idle");
    resetFormatFeedback();
  }

  function handleOverrideChange(nextFile: File | null) {
    resetFormatFeedback();

    if (!nextFile) {
      setOverrideFile(null);
      return;
    }

    if (!nextFile.name.toLowerCase().endsWith(".json")) {
      setOverrideFile(null);
      setFormatError("自定义覆盖规则只能上传 .json 文件。");
      setFormatStatus("error");
      return;
    }

    if (nextFile.size > MAX_OVERRIDE_SIZE) {
      setOverrideFile(null);
      setFormatError("自定义覆盖规则 JSON 不能超过 1MB。");
      setFormatStatus("error");
      return;
    }

    setOverrideFile(nextFile);
  }

  async function handleParseRequirements() {
    setParseError("");
    setParseResult(null);
    setParsedOverride(null);
    resetFormatFeedback();

    const trimmedText = requirementsText.trim();
    if (!trimmedText) {
      setParseStatus("error");
      setParseError("请先粘贴老师的格式要求。");
      return;
    }

    if (trimmedText.length > MAX_REQUIREMENTS_LENGTH) {
      setParseStatus("error");
      setParseError("格式要求内容过长，请控制在 5000 字以内。");
      return;
    }

    setIsParsing(true);
    setParseStatus("parsing");
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 150_000);

    try {
      const response = await fetch("/api/parse-requirements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          requirementsText: trimmedText,
          template: templateName || "default",
        }),
      });
      const data = (await response.json()) as ParseResult;

      if (!data.success) {
        setParseStatus("error");
        setParseError(data.message || "格式要求解析失败。");
        return;
      }

      setParseResult(data);
      setParsedOverride(data.normalizedOverride || data.override || data.parsedOverride || null);
      setParseStatus("success");
    } catch (error) {
      setParseStatus("error");
      if (error instanceof DOMException && error.name === "AbortError") {
        setParseError("解析请求超时，请检查 Kimi API 网络、模型名，或稍后重试。");
      } else {
        setParseError("解析请求失败：本地 Next.js 服务可能已停止，请在 web 目录重新运行 npm run dev。");
      }
    } finally {
      window.clearTimeout(timeoutId);
      setIsParsing(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormatError("");
    setResult(null);
    setNotices([]);

    if (!file) {
      setFormatError("请先选择 .docx 文件。");
      setFormatStatus("error");
      return;
    }

    if (!templateName) {
      setFormatError("请选择基础模板。");
      setFormatStatus("error");
      return;
    }

    if (requirementsText.trim() && !parsedOverride) {
      setFormatError("请先点击“解析格式要求”，确认识别结果后再开始处理。");
      setFormatStatus("error");
      return;
    }

    if (!file.name.toLowerCase().endsWith(".docx")) {
      setFormatError("只能上传 .docx 文件。");
      setFormatStatus("error");
      return;
    }

    if (file.size > MAX_FILE_SIZE) {
      setFormatError("Word 文件不能超过 10MB。");
      setFormatStatus("error");
      return;
    }

    if (overrideFile && !overrideFile.name.toLowerCase().endsWith(".json")) {
      setFormatError("自定义覆盖规则只能上传 .json 文件。");
      setFormatStatus("error");
      return;
    }

    if (overrideFile && overrideFile.size > MAX_OVERRIDE_SIZE) {
      setFormatError("自定义覆盖规则 JSON 不能超过 1MB。");
      setFormatStatus("error");
      return;
    }

    const formData = new FormData();
    formData.append("file", file);
    formData.append("template", templateName);
    if (parsedOverride) {
      formData.append("overrideText", JSON.stringify(parsedOverride));
    }
    if (overrideFile) {
      formData.append("override", overrideFile);
    }

    setIsSubmitting(true);
    setFormatStatus("processing");

    try {
      const response = await fetch("/api/format", {
        method: "POST",
        body: formData,
      });
      const data = (await response.json()) as FormatResult;

      if (!data.success) {
        setFormatStatus("error");
        setFormatError(data.message || "处理失败。");
        return;
      }

      setFormatStatus("success");
      setResult(data);
      setNotices(data.notices || []);
    } catch {
      setFormatStatus("error");
      setFormatError("处理请求失败，请确认本地服务正在运行。");
    } finally {
      setIsSubmitting(false);
    }
  }

  const selectedTemplate = templates.find((item) => item.name === templateName);
  const stats = result?.report?.stats;
  const abstractRelatedCount =
    (stats?.abstract_title || 0) + (stats?.abstract_content || 0);
  const keywordsCount = stats?.keywords || 0;
  const referenceCount =
    (stats?.reference_title || 0) + (stats?.reference_item || 0);
  const overrideEnabled = Boolean(result?.report?.override?.enabled);
  const overriddenFields = result?.report?.override?.overridden_fields || [];
  const hiddenOverriddenFieldCount = Math.max(0, overriddenFields.length - 10);
  const baseTemplateName =
    result?.report?.baseTemplate?.name || result?.report?.template.name || templateName;
  const parseWarnings = parseResult?.warnings || [];
  const selectedTemplateTitle = selectedTemplate
    ? getTemplateTitle(selectedTemplate)
    : getTemplateTitle({ name: templateName || "default", description: "" });

  return (
    <main className="page">
      <header className="header">
        <h1>Word 论文格式修改器</h1>
        <p>上传 Word 论文，粘贴老师的格式要求，系统将自动规范论文格式。</p>
      </header>

      <form className="workspace" onSubmit={handleSubmit}>
        <section className="main-grid">
          <div className="panel step-panel">
            <div className="step-label">1. 上传论文</div>
            <label className="field-label" htmlFor="file">
              Word 论文
            </label>
            <input
              id="file"
              type="file"
              accept=".docx"
              disabled={isSubmitting}
              onChange={(event) =>
                handleFileChange(event.target.files?.[0] || null)
              }
            />
            <div className="hint">仅支持 .docx，最大 10MB。</div>
            <div className="file-summary">
              {file ? `当前文件：${file.name}` : "尚未选择 Word 文件"}
            </div>
          </div>

          <div className="panel step-panel">
            <div className="step-label">2. 粘贴老师的格式要求</div>
            <label className="field-label" htmlFor="requirementsText">
              格式要求
            </label>
            <textarea
              id="requirementsText"
              value={requirementsText}
              disabled={isSubmitting || isParsing}
              spellCheck={false}
              placeholder={REQUIREMENTS_EXAMPLE}
              onChange={(event) => handleRequirementsChange(event.target.value)}
            />
            <div className="hint">
              常见规则会优先本地快速解析；复杂要求才调用 Kimi，并会缓存相同解析结果。
            </div>
            <div className="inline-actions">
              <button
                className="button"
                type="button"
                disabled={isParsing || !requirementsText.trim()}
                onClick={handleParseRequirements}
              >
                {isParsing ? "解析中" : "解析格式要求"}
              </button>
              <button
                className="text-button"
                type="button"
                disabled={isParsing || isSubmitting}
                onClick={() => handleRequirementsChange(REQUIREMENTS_EXAMPLE)}
              >
                使用示例
              </button>
              <button
                className="text-button"
                type="button"
                disabled={isParsing || isSubmitting || !requirementsText}
                onClick={() => handleRequirementsChange("")}
              >
                清空
              </button>
            </div>
            <StatusLine
              status={parseStatus}
              idle="可粘贴老师的自然语言格式要求，然后点击解析。"
              loading="正在解析老师格式要求……"
              success="格式要求解析成功，请检查识别结果。"
              error={`解析失败：${parseError}`}
            />
          </div>
        </section>

        <section className="template-notice">
          <strong>
            当前基础模板：{selectedTemplateTitle}（{templateName || "default"}）
          </strong>
          <span>
            未明确说明的格式将继承基础模板，系统只会用老师要求覆盖其中对应字段。
          </span>
        </section>

        {parseResult?.success ? (
          <section className="panel">
            <h2 className="section-title">识别出的格式规则</h2>
            {parseResult.mode ? (
              <p className="hint">
                解析模式：{getParseModeLabel(parseResult.mode)}
                {parseResult.cached ? "，已使用缓存" : ""}
              </p>
            ) : null}
            {parseResult.summary?.length ? (
              <ul className="rule-list">
                {parseResult.summary.map((item) => (
                  <li key={`${item.type}-${item.description}`}>
                    <strong>{item.label}</strong>
                    {item.fields?.length ? (
                      <dl className="field-list">
                        {item.fields.map((field) => (
                          <div key={`${item.type}-${field.key}`}>
                            <dt>{field.label}</dt>
                            <dd>
                              <code>{field.key}</code> = {field.value}
                            </dd>
                          </div>
                        ))}
                      </dl>
                    ) : (
                      <span>{item.description}</span>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="hint">没有识别出明确覆盖字段，将继承基础模板。</p>
            )}
            <p className="review-hint">
              下方仅显示老师要求中识别出的覆盖字段；未显示的字段会继续使用基础模板规则。
            </p>
            {parseWarnings.length ? (
              <div className="notice-block">
                <strong>系统提醒：</strong>
                <ul>
                  {parseWarnings.map((warning, index) => (
                    <li key={`${warning}-${index}`}>{warning}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            <details className="json-details debug-details">
              <summary>调试信息</summary>
              <DebugBlock title="rawModelOutput" value={parseResult.rawModelOutput || ""} />
              <DebugBlock title="parsedOverride" value={parseResult.parsedOverride} />
              <DebugBlock title="normalizedOverride" value={parseResult.normalizedOverride} />
              <DebugBlock title="finalRules" value={parseResult.finalRules} />
              <DebugBlock title="debugSummary" value={parseResult.debugSummary} />
            </details>
            <div className="result-actions">
              <button className="button" type="submit" disabled={!canSubmit}>
                {isSubmitting ? "正在修改 Word" : "开始修改 Word"}
              </button>
              {result?.downloadUrl ? (
                <a className="button download-button" href={result.downloadUrl}>
                  下载修改后的 Word
                </a>
              ) : null}
              <StatusLine
                status={formatStatus}
                idle="识别结果确认后，可以直接开始修改 Word。"
                loading="正在识别论文结构并应用格式……"
                success="处理完成，可以下载修改后的 Word。"
                error={`处理失败：${formatError}`}
              />
            </div>
          </section>
        ) : null}

        <section className="panel advanced-panel">
          <button
            className="advanced-toggle"
            type="button"
            aria-expanded={advancedOpen}
            onClick={() => setAdvancedOpen((open) => !open)}
          >
            高级设置
            <span>{advancedOpen ? "收起" : "展开"}</span>
          </button>

          {advancedOpen ? (
            <div className="advanced-content">
              <div>
                <h2 className="section-title">基础模板</h2>
                <p className="hint">
                  默认使用通用默认模板。需要课程论文排版时，可以切换模板。
                </p>
                <div className="template-grid">
                  {templates.length === 0 ? (
                    <div className="template-card disabled">未找到模板</div>
                  ) : (
                    templates.map((template) => (
                      <button
                        className={
                          template.name === templateName
                            ? "template-card selected"
                            : "template-card"
                        }
                        key={template.name}
                        type="button"
                        disabled={isSubmitting || isParsing}
                        onClick={() => {
                          setTemplateName(template.name);
                          setParsedOverride(null);
                          setParseResult(null);
                          setParseStatus("idle");
                        }}
                      >
                        <strong>{getTemplateTitle(template)}</strong>
                        <span>{template.description || "暂无模板说明"}</span>
                        <small>模板名：{template.name}</small>
                        {template.name === templateName ? <em>已选择</em> : null}
                      </button>
                    ))
                  )}
                </div>
              </div>

              <div className="field">
                <label className="field-label" htmlFor="override">
                  上传自定义覆盖规则 JSON 文件，可选
                </label>
                <input
                  id="override"
                  type="file"
                  accept=".json"
                  disabled={isSubmitting || isParsing}
                  onChange={(event) =>
                    handleOverrideChange(event.target.files?.[0] || null)
                  }
                />
                <div className="hint">
                  作为高级备用方式，仅支持 .json，最大 1MB。若已经解析出文本框规则，将优先使用解析结果。
                </div>
                <div className="file-summary">
                  {overrideFile
                    ? `当前 JSON 文件：${overrideFile.name}`
                    : "未上传自定义 JSON 文件"}
                </div>
              </div>
            </div>
          ) : null}
        </section>

        <section className="submit-row">
          <button className="button" type="submit" disabled={!canSubmit}>
            {isSubmitting ? "处理中" : "开始处理"}
          </button>
          {result?.downloadUrl ? (
            <a className="button secondary" href={result.downloadUrl}>
              下载修改后的 Word
            </a>
          ) : null}
          <StatusLine
            status={formatStatus}
            idle="请上传 Word 文件，并根据需要解析格式要求。"
            loading="正在识别论文结构并应用格式……"
            success="处理完成，可以下载修改后的 Word。"
            error={`处理失败：${formatError}`}
          />
        </section>

        {notices.map((notice, index) => (
          <div className="notice" key={`${notice}-${index}`}>
            {notice}
          </div>
        ))}
      </form>

      {result?.report ? (
        <section className="result">
          <div className="panel">
            <h2 className="section-title">处理结果</h2>
            {result.downloadUrl ? (
              <>
                <div className="download-banner">
                  <div>
                    <strong>Word 已生成</strong>
                    <span>可以下载修改后的论文文件。</span>
                  </div>
                  <a className="button download-button" href={result.downloadUrl}>
                    下载修改后的 Word
                  </a>
                </div>
                <div className="editing-mark-note">
                  <p>
                    提示：如果在 Word 中看到 ¶、↵ 或黑色小方块等符号，请关闭“开始 → 段落 → 显示/隐藏编辑标记”。这些是 Word 的编辑标记，不属于正文内容，不影响打印和提交。
                  </p>
                  <p>少量图表分页可能受 Word 自动排版影响，下载后可按需要手动微调。</p>
                </div>
              </>
            ) : null}
            <div className="source-grid">
              <Info label="基础模板" value={baseTemplateName} />
              <Info label="使用自定义覆盖" value={overrideEnabled ? "是" : "否"} />
              <Info label="覆盖字段数量" value={String(overriddenFields.length)} />
            </div>
          </div>

          <div className="panel">
            <h2 className="section-title">统计摘要</h2>
            <div className="stats">
              <Stat label="论文标题" value={stats?.paper_title || 0} />
              <Stat label="一级标题" value={stats?.heading_1 || 0} />
              <Stat label="二级标题" value={stats?.heading_2 || 0} />
              <Stat label="三级标题" value={stats?.heading_3 || 0} />
              <Stat label="正文段落" value={stats?.body || 0} />
              <Stat label="摘要相关段落" value={abstractRelatedCount} />
              <Stat label="关键词段落" value={keywordsCount} />
              <Stat label="表题数量" value={stats?.table_caption || 0} />
              <Stat label="图题数量" value={stats?.figure_caption || 0} />
              <Stat label="参考文献" value={referenceCount} />
              <Stat label="表格" value={stats?.table || 0} />
              <Stat label="警告数量" value={stats?.warning_count || 0} />
            </div>
          </div>

          {overrideEnabled ? (
            <div className="panel">
              <h2 className="section-title">已覆盖字段</h2>
              {overriddenFields.length === 0 ? (
                <p className="hint">没有检测到实际覆盖字段。</p>
              ) : (
                <>
                  <ul className="plain-list">
                    {overriddenFields.slice(0, 10).map((field) => (
                      <li key={field}>{field}</li>
                    ))}
                  </ul>
                  {hiddenOverriddenFieldCount > 0 ? (
                    <p className="hint">还有 {hiddenOverriddenFieldCount} 个字段未展示。</p>
                  ) : null}
                </>
              )}
              {result.report.override?.warnings?.length ? (
                <ul className="warning-list">
                  {result.report.override.warnings.map((warning, index) => (
                    <li className="warning-item" key={`${warning}-${index}`}>
                      <p>{warning}</p>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}

          <div className="panel">
            <h2 className="section-title">Warnings</h2>
            {result.report.warnings.length === 0 ? (
              <p className="hint">没有发现需要提示的潜在误判。</p>
            ) : (
              <ul className="warning-list">
                {result.report.warnings.map((warning, index) => (
                  <li className="warning-item" key={`${warning.message}-${index}`}>
                    <strong>
                      段落序号：
                      {warning.paragraph_index === null
                        ? "无"
                        : warning.paragraph_index}
                    </strong>
                    <p>{warning.text_preview || "无文本预览"}</p>
                    <p>{warning.message}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      ) : null}
    </main>
  );
}

function getTemplateTitle(template: TemplateItem) {
  if (template.name === "default") {
    return "通用默认模板";
  }

  if (template.name === "course_paper") {
    return "课程论文模板";
  }

  return template.displayName || template.description || template.name;
}

function getParseModeLabel(mode: ParseResult["mode"]) {
  if (mode === "mock") {
    return "本地 mock";
  }

  if (mode === "local") {
    return "本地快速解析";
  }

  return "Kimi API";
}

function StatusLine({
  status,
  idle,
  loading,
  success,
  error,
}: {
  status: ParseStatus | FormatStatus;
  idle: string;
  loading: string;
  success: string;
  error: string;
}) {
  if (status === "error") {
    return <div className="error">{error}</div>;
  }

  if (status === "success") {
    return <div className="success">{success}</div>;
  }

  if (status === "parsing" || status === "processing") {
    return <div className="status">{loading}</div>;
  }

  return <div className="status">{idle}</div>;
}

function DebugBlock({ title, value }: { title: string; value: unknown }) {
  return (
    <div className="debug-block">
      <h3>{title}</h3>
      <pre>{formatDebugValue(value)}</pre>
    </div>
  );
}

function formatDebugValue(value: unknown) {
  if (typeof value === "string") {
    return value || "(empty)";
  }

  if (value === null || value === undefined) {
    return "(empty)";
  }

  return JSON.stringify(value, null, 2);
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="info">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
