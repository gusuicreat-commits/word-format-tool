"use client";
import { useEffect, useRef, useState } from "react";
import { Upload, Download, Trash2, RotateCcw } from "lucide-react";
import FlowingRings from "./flowing-rings";
import StructureReview, { StructurePlan } from "./structure-review";
import { actionableWarnings, conciseWarning } from "../lib/result-warnings";

type Task = {
  id: string; filename: string; status: string; expiresAt: number; message?: string; requirements?: string;
  review?: StructurePlan; summary?: Array<{ label: string; description: string; fields?: Array<{ key: string; label: string; value: string }> }>;
  warnings?: string[]; result?: { downloadUrl: string; report: { warnings: Array<{ message: string; paragraph_index: number | null; table_index?: number; text_preview: string }> } };
};
const active = (task: Task | null) => !!task && ["queued", "parsing", "analyzing", "formatting"].includes(task.status);
const labels: Record<string, string> = { queued: "等待处理", parsing: "正在理解格式要求", analyzing: "正在分析文档", formatting: "正在排版" };
export default function HomePage() {
  const [ready, setReady] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [requirements, setRequirements] = useState("");
  const [task, setTask] = useState<Task | null>(null);
  const [plan, setPlan] = useState<StructurePlan | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  function accept(next: Task | null) {
    setTask(next);
    if (next?.status === "review") { setPlan(next.review || null); setConfirmed(false); setRequirements(next.requirements || ""); }
  }
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const session = await fetch("/api/session"); if (!session.ok) throw new Error();
        const response = await fetch("/api/tasks", { cache: "no-store" }); if (!response.ok) throw new Error();
        const data = await response.json(); if (alive) { accept(data.task); setReady(true); }
      } catch { if (alive) setError("服务暂时不可用，请刷新重试。"); }
    })();
    return () => { alive = false; };
  }, []);
  useEffect(() => {
    if (!active(task)) return;
    let cancelled = false;
    const timer = setInterval(async () => {
      try {
        const response = await fetch(`/api/tasks/${task!.id}`, { cache: "no-store" });
        if (!response.ok) throw new Error();
        const data = await response.json(); if (!cancelled) { accept(data.task); setError(""); }
      } catch { if (!cancelled) setError("连接暂时中断，正在重连；请勿重复上传。"); }
    }, 1500);
    return () => { cancelled = true; clearInterval(timer); };
  }, [task?.id, task?.status]);
  async function request(url: string, options: RequestInit) {
    setBusy(true); setError("");
    try {
      const response = await fetch(url, options); const data = await response.json();
      if (!response.ok) throw new Error(data.message || "操作失败，请重试。");
      accept(data.task || null); return true;
    } catch (e) { setError(e instanceof Error ? e.message : "连接失败，请重试。"); return false; }
    finally { setBusy(false); }
  }
  async function upload() {
    if (!file) { setError("请选择 Word 文件。"); return; }
    const form = new FormData(); form.set("file", file); form.set("requirements", requirements);
    await request("/api/tasks", { method: "POST", body: form });
  }
  async function remove() {
    if (!task || !window.confirm("立即删除本次上传、处理结果和报告？删除后无法下载。")) return;
    if (await request(`/api/tasks/${task.id}`, { method: "DELETE" })) { setFile(null); setPlan(null); setConfirmed(false); }
  }
  const locked = busy || active(task);
  const warnings = actionableWarnings(task?.result?.report.warnings || []);
  return <main className="page">
    <header className="header">
      <div className="topbar"><a className="brandmark" href="#workspace"><span>W</span><strong>论格</strong></a><nav className="topbar-nav"><a href="#workspace">开始排版</a>{task?.status === "done" && <a href="#output">处理结果</a>}</nav></div>
      <div className="hero-grid"><div className="hero-copy"><p className="eyebrow">WORD FORMAT TOOL</p><h1>Word 论文<br />格式修改器</h1><p className="hero-description">上传论文，填写格式要求。确认后下载修改结果。</p><a className="button hero-cta" href="#workspace">开始排版</a></div><figure className="hero-artwork"><FlowingRings /></figure></div>
    </header>
    <div className="workspace" id="workspace">
      {!task ? <>
        <section className="main-grid">
          <div className="panel step-panel"><div className="step-label"><span>01 / INPUT</span><strong>上传论文</strong></div>
            <input ref={input} className="upload-native" type="file" accept=".docx" aria-label="Word 论文" disabled={locked} onChange={e => setFile(e.target.files?.[0] || null)} />
            <button className="upload-zone" disabled={locked} onClick={() => input.current?.click()} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); if (!locked) setFile(e.dataTransfer.files[0] || null); }}><Upload size={30} /><strong>{file?.name || "选择或拖入 Word 文件"}</strong><span>DOCX · 最大 10MB</span></button>
          </div>
          <div className="panel step-panel"><div className="step-label"><span>02 / REQUIREMENTS</span><strong>格式要求</strong></div><label className="field-label" htmlFor="requirements">格式要求（选填）</label><textarea id="requirements" maxLength={5000} value={requirements} onChange={e => setRequirements(e.target.value)} disabled={locked} placeholder="例如：正文宋体小四，1.5倍行距，一级标题黑体三号。" /><p className="hint">未填写的部分使用默认格式。复杂要求可能发送至第三方 AI 解析，勿填写敏感内容；论文文件由本服务处理。</p></div>
        </section>
        <div className="submit-row"><button className="button primary-button" disabled={!ready || locked || !file} onClick={upload}>{busy ? "正在上传" : "下一步"}</button><span className="hint">文件短期保留，可主动删除。</span></div>
      </> : <>
        <section className="panel task-overview"><p>当前处理文档：{task.filename}</p>{active(task) && <p role="status">{labels[task.status]}</p>}
          {task.status === "failed" && <><p role="alert">{task.message || "处理失败。"}</p><button className="button" disabled={busy} onClick={() => request(`/api/tasks/${task.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "retry" }) })}><RotateCcw size={16} />重试</button></>}
        </section>
        {task.status === "review" && plan && <>
          <section className="panel"><h2>确认格式</h2>{task.summary?.length ? <ul className="rule-list">{task.summary.map((item, i) => <li key={i}><strong>{item.label}</strong><p className="rule-summary">{item.fields?.filter(f => !f.key.endsWith("_pt") || !item.fields?.some(other => other.key === f.key.replace(/_pt$/, "_chars"))).map(f => `${f.label}：${f.value}`).join("；") || item.description}</p></li>)}</ul> : <p>使用默认格式。</p>}
            {task.warnings?.filter(w => w !== "已使用本地快速解析，复杂或含糊要求仍建议人工确认。").map((w, i) => <p className="hint" key={i}>{w}</p>)}
          </section>
          <section className="panel"><details><summary>修改格式要求</summary><textarea aria-label="修改格式要求" value={requirements} maxLength={5000} disabled={busy} onChange={e => setRequirements(e.target.value)} /><button className="button" disabled={busy} onClick={() => request(`/api/tasks/${task.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "edit", requirements }) })}>重新分析</button></details></section>
          <StructureReview plan={plan} onChange={setPlan} confirmed={confirmed} onConfirm={setConfirmed} disabled={busy} />
          <div className="submit-row"><button className="button primary-button" disabled={!confirmed || busy || requirements !== (task.requirements || "")} onClick={() => request(`/api/tasks/${task.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ review: plan }) })}>确认并修改 Word</button>{requirements !== (task.requirements || "") && <p>要求已修改，请先重新分析。</p>}</div>
        </>}
        {task.status === "done" && task.result && <section className="result" id="output"><div className="panel"><h2>Word 已生成</h2><a className="button download-button" href={task.result.downloadUrl}><Download size={16} />下载修改后的 Word</a><p className="hint">请检查最终分页和图表，文件生成不代表已通过视觉验收。</p>{warnings.length > 0 && <><h3>需要注意的地方</h3><ul className="warning-list">{warnings.map((w, i) => <li className="warning-item" key={i}>{w.table_index !== undefined ? <strong>第 {w.table_index + 1} 个表格</strong> : w.paragraph_index !== null ? <strong>第 {w.paragraph_index + 1} 段</strong> : null}<p>{conciseWarning(w.message)}</p>{w.text_preview && <p className="hint">{w.text_preview}</p>}</li>)}</ul></>}</div></section>}
        <div className="submit-row"><p className="hint">文件访问截止：{new Date(task.expiresAt).toLocaleString()}；到期后自动清理。</p><button className="text-button" disabled={locked} onClick={remove}><Trash2 size={16} />删除文件并重新开始</button></div>
      </>}
      {error && <div className="panel" role="alert">{error}</div>}
    </div>
    <footer className="footer">论格 · 论文格式处理</footer>
  </main>;
}
