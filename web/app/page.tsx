"use client";

import { FormEvent, ReactNode, useEffect, useMemo, useRef, useState } from "react";

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
  errorCode?: string;
  recoveryActions?: RecoveryAction[];
  jobId?: string;
  mode?: "kimi_canonical" | "mock_canonical" | "kimi" | "mock" | "local";
  parserMode?: "kimi_canonical" | "mock_canonical" | "kimi" | "mock" | "local";
  complexity?: unknown;
  canonicalRequirementsText?: string;
  override?: unknown;
  rawModelOutput?: string;
  parsedOverride?: unknown;
  parsedRules?: unknown;
  rawAiRules?: unknown;
  normalizedAiRules?: unknown;
  normalizedOverride?: unknown;
  validatedRules?: unknown;
  finalRules?: unknown;
  debugSummary?: unknown;
  unsupportedModules?: unknown;
  conflictResult?: unknown;
  overriddenFields?: string[];
  warnings?: string[];
  summary?: RuleSummaryItem[];
  finalRulesPreview?: unknown;
  cached?: boolean;
};

type RecoveryAction = {
  id: string;
  label: string;
  description?: string;
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
  moduleStatus?: Record<string, ModuleStatusItem>;
  warnings: WarningItem[];
};

type ModuleStatusItem = {
  status?: string;
  count?: number;
  action?: string;
  note?: string;
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
const MAX_REQUIREMENTS_LENGTH = 5000;

const REQUIREMENTS_EXAMPLE = `论文标题黑体三号居中；
正文宋体小四，1.5倍行距，首行缩进2字符；
一级标题黑体小三；
二级标题黑体四号；
图题和表题宋体五号居中；
参考文献宋体五号。`;

const MODULE_STATUS_ORDER = [
  "paper_title",
  "abstract_cn",
  "keywords_cn",
  "abstract_en",
  "keywords_en",
  "toc",
  "heading",
  "body",
  "table",
  "figure_caption",
  "table_caption",
  "reference",
  "appendix",
  "page",
  "latin_digit_format",
  "header_footer",
  "page_number",
];

export default function HomePage() {
  const [templates, setTemplates] = useState<TemplateItem[]>([]);
  const [templateName, setTemplateName] = useState("default");
  const [file, setFile] = useState<File | null>(null);
  const [requirementsText, setRequirementsText] = useState("");
  const [parsedOverride, setParsedOverride] = useState<unknown | null>(null);
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [parseStatus, setParseStatus] = useState<ParseStatus>("idle");
  const [parseError, setParseError] = useState("");
  const [parseRecoveryActions, setParseRecoveryActions] = useState<RecoveryAction[]>([]);
  const [formatStatus, setFormatStatus] = useState<FormatStatus>("idle");
  const [formatError, setFormatError] = useState("");
  const [result, setResult] = useState<FormatResult | null>(null);
  const [notices, setNotices] = useState<string[]>([]);
  const [isParsing, setIsParsing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [conflictAcknowledged, setConflictAcknowledged] = useState(false);
  const [rulesAcknowledged, setRulesAcknowledged] = useState(false);
  const [parseSlowHintVisible, setParseSlowHintVisible] = useState(false);
  const requirementsTextRef = useRef<HTMLTextAreaElement>(null);
  const parseAbortControllerRef = useRef<AbortController | null>(null);
  const parseRunIdRef = useRef(0);

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

  const hasUnconfirmedConflictWarnings = Boolean(
    parseResult?.warnings?.some(isConflictWarning) && !conflictAcknowledged,
  );
  const requiresRulesAcknowledgement = Boolean(requirementsText.trim() && parsedOverride);
  const hasUnconfirmedRules = requiresRulesAcknowledgement && !rulesAcknowledged;
  const canSubmit = useMemo(() => {
    return Boolean(
      file &&
        templateName &&
        !isSubmitting &&
        !isParsing &&
        !hasUnconfirmedRules &&
        !hasUnconfirmedConflictWarnings,
    );
  }, [
    file,
    templateName,
    isSubmitting,
    isParsing,
    hasUnconfirmedRules,
    hasUnconfirmedConflictWarnings,
  ]);

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
    setParseRecoveryActions([]);
    setParseSlowHintVisible(false);
    setParseStatus("idle");
    setConflictAcknowledged(false);
    setRulesAcknowledged(false);
    resetFormatFeedback();
  }

  async function handleParseRequirements(forceMode: "auto" | "local" = "auto") {
    const runId = parseRunIdRef.current + 1;
    parseRunIdRef.current = runId;
    setParseError("");
    setParseRecoveryActions([]);
    setParseSlowHintVisible(false);
    setParseResult(null);
    setParsedOverride(null);
    setConflictAcknowledged(false);
    setRulesAcknowledged(false);
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
    parseAbortControllerRef.current = controller;
    const timeoutId = window.setTimeout(() => controller.abort(), 150_000);
    const slowHintTimeoutId = window.setTimeout(() => {
      if (parseRunIdRef.current === runId) {
        setParseSlowHintVisible(true);
      }
    }, 15_000);

    try {
      const response = await fetch("/api/parse-requirements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          requirementsText: trimmedText,
          template: templateName || "default",
          forceMode,
        }),
      });
      const data = (await response.json()) as ParseResult;
      if (parseRunIdRef.current !== runId) {
        return;
      }

      if (!data.success) {
        setParseStatus("error");
        setParseError(data.message || "格式要求解析失败。");
        setParseRecoveryActions(data.recoveryActions || getDefaultRecoveryActions());
        return;
      }

      setParseResult(data);
      setParsedOverride(data.normalizedOverride || data.override || data.parsedOverride || null);
      setConflictAcknowledged(false);
      setRulesAcknowledged(false);
      setParseStatus("success");
    } catch (error) {
      if (parseRunIdRef.current !== runId) {
        return;
      }
      setParseStatus("error");
      if (error instanceof DOMException && error.name === "AbortError") {
        setParseError("识别超时，请检查网络或稍后重试。");
      } else {
        setParseError("识别失败：本地页面服务可能已停止，请重新启动后再试。");
      }
      setParseRecoveryActions(getDefaultRecoveryActions());
    } finally {
      window.clearTimeout(timeoutId);
      window.clearTimeout(slowHintTimeoutId);
      if (parseRunIdRef.current === runId) {
        parseAbortControllerRef.current = null;
        setParseSlowHintVisible(false);
        setIsParsing(false);
      }
    }
  }

  function handleUseLocalParser() {
    parseAbortControllerRef.current?.abort();
    void handleParseRequirements("local");
  }

  function handleEditRequirementsAfterParseError() {
    setParseError("");
    setParseRecoveryActions([]);
    setParseSlowHintVisible(false);
    setParseStatus("idle");
    requirementsTextRef.current?.focus();
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
      setFormatError("请选择默认排版方案。");
      setFormatStatus("error");
      return;
    }

    if (requirementsText.trim() && !parsedOverride) {
      setFormatError("请先点击“解析格式要求”，确认识别结果后再开始修改。");
      setFormatStatus("error");
      return;
    }

    if (hasUnconfirmedRules) {
      setFormatError("请先确认识别出的格式规则，再开始修改 Word。");
      setFormatStatus("error");
      return;
    }

    if (hasUnconfirmedConflictWarnings) {
      setFormatError("有些格式要求前后不太一致，请先确认后再继续。");
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

    const formData = new FormData();
    formData.append("file", file);
    formData.append("template", templateName);
    if (parsedOverride) {
      formData.append("overrideText", JSON.stringify(parsedOverride));
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
        setFormatError(data.message || "修改失败。");
        return;
      }

      setFormatStatus("success");
      setResult(data);
      setNotices(data.notices || []);
    } catch {
      setFormatStatus("error");
      setFormatError("修改失败，请确认本地服务正在运行。");
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
  const baseTemplateName =
    result?.report?.baseTemplate?.name || result?.report?.template.name || templateName;
  const baseTemplateDisplayName = getTemplateTitle({
    name: baseTemplateName,
    description: result?.report?.baseTemplate?.description || "",
  });
  const parseWarnings = parseResult?.warnings || [];
  const parseConflictWarnings = parseWarnings.filter(isConflictWarning);
  const parseRegularWarnings = parseWarnings.filter((warning) => !isConflictWarning(warning));
  const resultOverrideWarnings = result?.report?.override?.warnings || [];
  const resultConflictWarnings = resultOverrideWarnings.filter(isConflictWarning);
  const moduleStatus = result?.report?.moduleStatus || {};
  const selectedTemplateTitle = selectedTemplate
    ? getTemplateTitle(selectedTemplate)
    : getTemplateTitle({ name: templateName || "default", description: "" });

  return (
    <main className="page">
      <header className="header">
        <h1>Word 论文格式修改器</h1>
        <p>上传 Word 论文，粘贴老师的格式要求，系统将自动规范论文格式。</p>
        <p className="header-subnote">先帮你读懂老师要求，再按确认后的规则修改 Word。</p>
      </header>

      <form className="workspace" onSubmit={handleSubmit}>
        <section className="main-grid">
          <div className="panel step-panel">
            <div className="step-label">步骤 1：上传论文</div>
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
            <div className="step-label">步骤 2：粘贴格式要求</div>
            <label className="field-label" htmlFor="requirementsText">
              格式要求
            </label>
            <textarea
              id="requirementsText"
              ref={requirementsTextRef}
              value={requirementsText}
              disabled={isSubmitting || isParsing}
              spellCheck={false}
              placeholder={REQUIREMENTS_EXAMPLE}
              onChange={(event) => handleRequirementsChange(event.target.value)}
            />
            <div className="hint">
              简单要求会快速识别；复杂要求会多花一点时间。相同内容会自动复用上次结果。
            </div>
            <div className="inline-actions">
              <button
                className="button primary-button"
                type="button"
                disabled={isParsing || !requirementsText.trim()}
                onClick={() => handleParseRequirements()}
              >
                {isParsing ? "解析中" : "解析格式要求"}
              </button>
              <button
                className="text-button secondary-action"
                type="button"
                disabled={isParsing || isSubmitting}
                onClick={() => handleRequirementsChange(REQUIREMENTS_EXAMPLE)}
              >
                使用示例
              </button>
              <button
                className="text-button weak-action"
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
              loading="正在理解格式要求，复杂内容可能需要 20-60 秒。"
              success="格式要求解析成功，请检查识别结果。"
              error={`解析失败：${parseError}`}
            />
            {parseStatus === "parsing" && parseSlowHintVisible ? (
              <div className="notice parse-wait-notice" role="status">
                <p>还在理解复杂要求，可以继续等待，也可以改用快速识别。</p>
                <button
                  className="button secondary"
                  type="button"
                  disabled={!requirementsText.trim()}
                  onClick={handleUseLocalParser}
                >
                  改用快速识别
                </button>
              </div>
            ) : null}
            {parseStatus === "error" && parseRecoveryActions.length ? (
              <div className="parse-recovery" role="group" aria-label="解析失败后的可选操作">
                <p>可以选择下面的方式继续，但解析成功并确认规则前不会修改 Word。</p>
                <div className="inline-actions">
                  <button
                    className="button primary-button"
                    type="button"
                    disabled={isParsing || !requirementsText.trim()}
                    onClick={() => handleParseRequirements()}
                  >
                    重新识别
                  </button>
                  <button
                    className="button secondary"
                    type="button"
                    disabled={isParsing || !requirementsText.trim()}
                    onClick={handleUseLocalParser}
                  >
                    改用快速识别
                  </button>
                  <button
                    className="text-button secondary-action"
                    type="button"
                    disabled={isParsing}
                    onClick={handleEditRequirementsAfterParseError}
                  >
                    返回修改要求
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </section>

        <section className="template-notice">
          <strong>
            当前排版方案：{selectedTemplateTitle}
          </strong>
          <span>
            老师没单独说明的地方，会按这个方案的默认规则处理，例如正文、标题、摘要关键词、图题表题、参考文献和页边距。
          </span>
          <details className="inheritance-details">
            <summary>查看默认会处理哪些内容</summary>
            <p>没有单独说明时，下面这些会按默认方案处理：</p>
            <ul>
              <li>正文基础格式</li>
              <li>一级/二级/三级标题格式</li>
              <li>摘要和关键词格式</li>
              <li>图题和表题格式</li>
              <li>参考文献格式</li>
              <li>页边距等页面基础设置</li>
            </ul>
          </details>
        </section>

        {parseResult?.success ? (
          <section className="panel">
            <h2 className="section-title">识别出的格式规则</h2>
            {parseResult.mode ? (
              <p className="hint">
                识别方式：{getParseModeLabel(parseResult.mode)}
                {parseResult.cached ? "，已复用上次结果" : ""}
              </p>
            ) : null}
            {parseResult.canonicalRequirementsText ? (
              <div className="canonical-requirements">
                <h3>整理后的老师要求</h3>
                <pre>{parseResult.canonicalRequirementsText}</pre>
              </div>
            ) : null}
            {parseResult.summary?.length ? (
              <ul className="rule-list">
                {parseResult.summary.map((item) => (
                  <li key={`${item.type}-${item.description}`}>
                    <div className="rule-heading">
                      <strong>{item.label}</strong>
                      <span>{getRuleGroupDescription(item.type)}</span>
                    </div>
                    {item.fields?.length ? (
                      <dl className="field-list">
                        {item.fields.map((field) => (
                          <div key={`${item.type}-${field.key}`}>
                            <dt>{field.label}</dt>
                            <dd>
                              <span className="field-value">{field.value}</span>
                              <code>{field.key}</code>
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
              <p className="hint">没有识别到需要单独修改的格式，后续会按默认排版方案处理。</p>
            )}
            <p className="review-hint">
              这里只列出老师明确提到的格式；没提到的地方会按默认排版方案处理。
            </p>
            <label className="rules-confirm">
              <input
                type="checkbox"
                checked={rulesAcknowledged}
                disabled={isSubmitting}
                onChange={(event) => setRulesAcknowledged(event.target.checked)}
              />
              <span>我已确认以上识别出的格式规则，再开始修改 Word。</span>
            </label>
            {parseConflictWarnings.length ? (
              <ConflictWarningCard warnings={parseConflictWarnings}>
                <label className="conflict-confirm">
                  <input
                    type="checkbox"
                    checked={conflictAcknowledged}
                    disabled={isSubmitting}
                    onChange={(event) => setConflictAcknowledged(event.target.checked)}
                  />
                  <span>我已看过这些不一致的地方，仍然继续修改。</span>
                </label>
              </ConflictWarningCard>
            ) : null}
            {parseRegularWarnings.length ? (
              <div className="notice-block">
                <strong>系统提醒：</strong>
                <ul>
                  {parseRegularWarnings.map((warning, index) => (
                    <li key={`${warning}-${index}`}>{getFriendlyWarningMessage(warning)}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            <details className="json-details debug-details">
              <summary>技术细节（一般不用看）</summary>
              <DebugBlock title="canonicalRequirementsText" value={parseResult.canonicalRequirementsText || ""} />
              <DebugBlock title="rawModelOutput" value={parseResult.rawModelOutput || ""} />
              <DebugBlock title="parsedOverride" value={parseResult.parsedOverride} />
              <DebugBlock title="parsedRules" value={parseResult.parsedRules} />
              <DebugBlock title="raw_ai_rules" value={parseResult.rawAiRules} />
              <DebugBlock title="normalized_ai_rules" value={parseResult.normalizedAiRules} />
              <DebugBlock title="normalizedOverride" value={parseResult.normalizedOverride} />
              <DebugBlock title="validatedRules" value={parseResult.validatedRules} />
              <DebugBlock title="unsupportedModules" value={parseResult.unsupportedModules} />
              <DebugBlock title="conflictResult" value={parseResult.conflictResult} />
              <DebugBlock title="finalRules" value={parseResult.finalRules} />
              <DebugBlock title="debugSummary" value={parseResult.debugSummary} />
            </details>
            <div className="result-actions">
              <button className="button primary-button" type="submit" disabled={!canSubmit}>
                {isSubmitting ? "正在修改 Word" : "开始修改 Word"}
              </button>
              {parseConflictWarnings.length ? (
                <p className="conflict-action-note">
                  有些格式要求前后不太一致，请确认后再继续。
                </p>
              ) : null}
              {formatStatus !== "success" ? (
                <StatusLine
                  status={formatStatus}
                  idle="确认识别结果后，可以开始修改 Word。"
                  loading="正在识别论文结构并应用格式……"
                  success=""
                  error={`处理失败：${formatError}`}
                />
              ) : null}
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
            高级设置（一般无需修改）
            <span>{advancedOpen ? "收起" : "展开"}</span>
          </button>

          {advancedOpen ? (
            <div className="advanced-content">
              <div className="advanced-section">
                <h2 className="section-title">默认排版方案</h2>
                <p className="hint">
                  一般不用改。只有明确要按课程论文排版时，再切换这里。
                </p>
                <div className="template-grid">
                  {templates.length === 0 ? (
                    <div className="template-card disabled">未找到可用方案</div>
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
                          setConflictAcknowledged(false);
                          setRulesAcknowledged(false);
                        }}
                      >
                        <strong>{getTemplateTitle(template)}</strong>
                        <span>{getTemplateCardDescription(template)}</span>
                        <small>方案代码：{template.name}</small>
                        {template.name === templateName ? <em>已选择</em> : null}
                      </button>
                    ))
                  )}
                </div>
              </div>

            </div>
          ) : null}
        </section>

        {!parseResult?.success ? (
          <section className="submit-row">
            <button className="button primary-button" type="submit" disabled={!canSubmit}>
              {isSubmitting ? "处理中" : "开始处理"}
            </button>
            {parseConflictWarnings.length ? (
              <p className="conflict-action-note">
                有些格式要求前后不太一致，请确认后再继续。
              </p>
            ) : null}
            {formatStatus !== "success" ? (
              <StatusLine
                status={formatStatus}
              idle="请上传 Word 文件；如果有老师要求，请先粘贴并识别。"
                loading="正在识别论文结构并应用格式……"
                success=""
                error={`处理失败：${formatError}`}
              />
            ) : null}
          </section>
        ) : null}

        {notices.map((notice, index) => (
          <div className="notice" key={`${notice}-${index}`}>
            {notice}
          </div>
        ))}
      </form>

      {result?.report ? (
        <section className="result">
          <div className="panel">
            <h2 className="section-title">修改结果</h2>
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
                {resultConflictWarnings.length ? (
                  <ConflictWarningCard
                    title="这次修改有需要确认的地方"
                    warnings={resultConflictWarnings}
                  />
                ) : null}
              </>
            ) : null}
            <div className="source-grid">
              <Info label="使用的排版方案" value={baseTemplateDisplayName} />
            </div>
            {Object.keys(moduleStatus).length ? (
              <details className="module-status-panel">
                <summary>这次识别到的论文内容</summary>
                <p>
                  系统只会修改比较确定的部分；没看准或老师没要求的地方，不会强行改。
                </p>
                <ul>
                  {MODULE_STATUS_ORDER.map((moduleKey) => {
                    const item = moduleStatus[moduleKey];
                    if (!item) {
                      return null;
                    }
                    return (
                      <li key={moduleKey}>
                        <strong>{getModuleStatusLabel(moduleKey)}</strong>
                        <span>
                          {getModuleStatusText(item.status)}，{getModuleActionText(item.action)}
                        </span>
                        {item.note ? <small>{item.note}</small> : null}
                      </li>
                    );
                  })}
                </ul>
              </details>
            ) : null}
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
              <Stat label="提醒数量" value={stats?.warning_count || 0} />
            </div>
          </div>

          <div className="panel">
            <h2 className="section-title">需要注意的地方</h2>
            {result.report.warnings.length === 0 ? (
              <p className="hint">暂时没有需要特别注意的地方。</p>
            ) : (
              <ul className="warning-list">
                {result.report.warnings.map((warning, index) => (
                  <li className="warning-item" key={`${warning.message}-${index}`}>
                    <strong>{getWarningLocationText(warning)}</strong>
                    <p>相关文字：{warning.text_preview || "这条提示没有对应的文字预览"}</p>
                    <p>{getFriendlyWarningMessage(warning.message)}</p>
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
    return "通用论文方案";
  }

  if (template.name === "course_paper") {
    return "课程论文方案";
  }

  return template.displayName || template.description || template.name;
}

function getTemplateCardDescription(template: TemplateItem) {
  if (template.name === "default") {
    return "适合一般论文、报告、作业，格式较稳妥。";
  }

  if (template.name === "course_paper") {
    return "标题更突出，适合课程论文、结课论文等场景。";
  }

  return template.description || "自定义排版方案。";
}

function getRuleGroupDescription(type: string) {
  const descriptions: Record<string, string> = {
    paper_title: "论文主标题格式",
    abstract_title: "摘要标题格式",
    abstract_content: "摘要正文格式",
    keywords: "关键词段落格式",
    abstract_en_title: "英文摘要标题格式",
    abstract_en_content: "英文摘要正文格式",
    keywords_en: "英文关键词格式",
    heading_1: "一级标题格式",
    heading_2: "二级标题格式",
    heading_3: "三级标题格式",
    body: "正文段落格式",
    table_caption: "表题格式",
    figure_caption: "图题格式",
    reference_title: "参考文献标题格式",
    reference_item: "参考文献条目格式",
    table_text: "表格文字格式",
  };

  return descriptions[type] || "格式规则";
}

function getModuleStatusLabel(moduleKey: string) {
  const labels: Record<string, string> = {
    paper_title: "论文标题",
    abstract_cn: "中文摘要",
    keywords_cn: "中文关键词",
    abstract_en: "英文摘要",
    keywords_en: "英文关键词",
    toc: "目录",
    heading: "标题层级",
    body: "正文",
    table: "表格",
    figure_caption: "图题",
    table_caption: "表题",
    reference: "参考文献",
    appendix: "附录",
    page: "页面设置",
    latin_digit_format: "英文和数字",
    header_footer: "页眉页脚",
    page_number: "页码",
  };

  return labels[moduleKey] || moduleKey;
}

function getModuleStatusText(status?: string) {
  const labels: Record<string, string> = {
    detected: "已找到",
    not_detected: "未找到",
    not_requested: "老师没要求",
    low_confidence: "不太确定",
    detected_but_not_supported: "看到了，但暂时不会自动改",
  };

  return labels[status || ""] || status || "未知状态";
}

function getModuleActionText(action?: string) {
  const labels: Record<string, string> = {
    formatted: "已修改",
    skipped: "未修改",
    boundary_only: "只用来判断位置",
    protected: "已保护，不乱改",
    warning_only: "只提醒，不自动改",
  };

  return labels[action || ""] || action || "无需要操作";
}

function getParseModeLabel(mode: ParseResult["mode"]) {
  if (mode === "kimi_canonical") {
    return "智能识别";
  }

  if (mode === "mock_canonical") {
    return "测试识别";
  }

  if (mode === "mock") {
    return "测试识别";
  }

  if (mode === "local") {
    return "快速识别";
  }

  return "智能识别";
}

function getDefaultRecoveryActions(): RecoveryAction[] {
  return [
    {
      id: "retry_kimi",
      label: "重新识别",
      description: "重新理解老师的格式要求，不会修改 Word。",
    },
    {
      id: "use_local_parser",
      label: "改用快速识别",
      description: "按常见规则快速识别，复杂要求需要你多看一眼。",
    },
    {
      id: "edit_requirements",
      label: "返回修改要求",
      description: "继续编辑老师格式要求后再解析。",
    },
  ];
}

function isConflictWarning(warning: string) {
  return warning.includes("存在冲突");
}

function getWarningLocationText(warning: WarningItem) {
  if (warning.paragraph_index === null) {
    return "位置：未定位到具体段落";
  }

  return `位置：第 ${warning.paragraph_index} 段`;
}

function getFriendlyWarningMessage(message: string) {
  const headingConflict = message.match(
    /标题层级冲突：原 Word 样式 (.+?) 对应 (heading_\d)，但文本编号对应 (heading_\d)，已按文本编号层级处理。/,
  );

  if (headingConflict) {
    const [, originalStyle, originalLevel, textLevel] = headingConflict;
    const originalLevelText = getHeadingLevelText(originalLevel || originalStyle);
    const textLevelText = getHeadingLevelText(textLevel);
    return `这段标题的样式和编号不一致：Word 里原来看起来像${originalLevelText}，但从编号看应该是${textLevelText}。系统已经按编号处理成${textLevelText}。`;
  }

  if (message.includes("页眉") || message.includes("页脚")) {
    return "页眉页脚这类内容暂时只做提醒，不会自动改动。下载后可以在 Word 里手动检查。";
  }

  if (message.includes("页码")) {
    return "页码暂时只做提醒，不会自动插入或重新编号。下载后可以在 Word 里手动检查。";
  }

  return message
    .replaceAll("heading_1", "一级标题")
    .replaceAll("heading_2", "二级标题")
    .replaceAll("heading_3", "三级标题")
    .replaceAll("Heading 1", "一级标题")
    .replaceAll("Heading 2", "二级标题")
    .replaceAll("Heading 3", "三级标题");
}

function getHeadingLevelText(value: string) {
  if (value.includes("heading_1") || value.includes("Heading 1")) {
    return "一级标题";
  }

  if (value.includes("heading_2") || value.includes("Heading 2")) {
    return "二级标题";
  }

  if (value.includes("heading_3") || value.includes("Heading 3")) {
    return "三级标题";
  }

  return "当前识别到的标题";
}

function ConflictWarningCard({
  title = "发现几处要求前后不太一致",
  warnings,
  children,
}: {
  title?: string;
  warnings: string[];
  children?: ReactNode;
}) {
  return (
    <div className="conflict-warning-card" role="alert">
      <div className="conflict-warning-heading">
        <span aria-hidden="true">⚠️</span>
        <strong>{title}</strong>
      </div>
      <p>
        老师要求里有几处说法前后不完全一致。系统会按后面更明确的说法处理，但建议你看一眼。
      </p>
      <ul>
        {warnings.map((warning, index) => (
          <li key={`${warning}-${index}`}>{getFriendlyWarningMessage(warning)}</li>
        ))}
      </ul>
      {children}
    </div>
  );
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
