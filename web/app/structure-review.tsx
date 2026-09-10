"use client";
import { useState } from "react";

export type StructurePlan = {
  version: number;
  input_sha256: string;
  rules_sha256: string;
  section_count: number;
  items: Array<{ key: string; text: string; detected: string; locked: boolean; needs_review?: boolean; has_image?: boolean; type: string; preserve: boolean }>;
};

const roles: Record<string, string> = { body: "正文", paper_title: "论文标题", heading_1: "一级标题", heading_2: "二级标题", heading_3: "三级标题", table_caption: "表题", figure_caption: "图题", table: "表格" };
const names: Record<string, string> = { ...roles, abstract_title: "中文摘要标题", abstract_content: "中文摘要", abstract_cn_title: "中文摘要标题", abstract_cn_content: "中文摘要", abstract_en_title: "英文摘要标题", abstract_en_content: "英文摘要", keywords: "关键词", keywords_en: "英文关键词", keywords_cn_label: "关键词标签", keywords_cn_content: "关键词内容", keywords_en_label: "英文关键词标签", keywords_en_content: "英文关键词内容", reference_title: "参考文献标题", reference_item: "参考文献条目" };

export default function StructureReview({ plan, onChange, confirmed, onConfirm, disabled }: {
  plan: StructurePlan; onChange: (plan: StructurePlan) => void; confirmed: boolean;
  onConfirm: (value: boolean) => void; disabled: boolean;
}) {
  const [query, setQuery] = useState("");
  const [showProtection, setShowProtection] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const update = (key: string, patch: { type?: string; preserve?: boolean }) => {
    onChange({ ...plan, items: plan.items.map(item => item.key === key ? { ...item, ...patch } : item) });
    onConfirm(false);
  };
  return <section className="structure-review" aria-label="文档结构确认">
    <h2>需要核对的内容</h2>
    <p>{plan.items.filter(item => item.needs_review || item.locked || item.preserve).length} 项待核对 · 共 {plan.items.length} 项</p>
    <label><input type="checkbox" checked={showAll} onChange={event => setShowAll(event.target.checked)} />查看全部结构</label>
    <label><input type="checkbox" checked={showProtection} onChange={event => setShowProtection(event.target.checked)} />高级选项：手动保留格式</label>
    <input className="structure-search" type="search" aria-label="搜索文档内容" placeholder="搜索文档内容" value={query} onChange={event => setQuery(event.target.value)} />
    <div className="structure-review-list">
      {plan.items.map((item, index) => ({ item, index })).filter(({ item }) => (showAll || showProtection || query.trim() || item.needs_review || item.locked || item.preserve) && item.text.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())).map(({ item, index }) => <div className="structure-review-row" key={item.key}>
        <div className="structure-review-text"><small>{index + 1} · {item.key.startsWith("t:") ? "表格" : "段落"}{item.has_image ? " · 含图片" : ""}</small><p>{item.text}</p></div>
        <select aria-label={`类型 ${item.key}`} value={item.type} disabled={disabled || item.locked || item.key.startsWith("t:") || item.preserve} onChange={event => update(item.key, { type: event.target.value })}>
          <option value="auto">{names[item.detected] || "待核对"}（原识别）</option>
          {Object.entries(roles).filter(([key]) => key !== "table").map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
        {item.locked ? <span>自动保护</span> : showProtection ? <label><input type="checkbox" checked={item.preserve} disabled={disabled} onChange={event => update(item.key, { preserve: event.target.checked })} />保留原格式</label> : item.preserve ? <span>已保留原格式</span> : null}
      </div>)}
    </div>
    <label className="structure-confirm"><input type="checkbox" checked={confirmed} disabled={disabled} onChange={event => onConfirm(event.target.checked)} />我已确认格式要求和需核对的内容</label>
  </section>;
}
