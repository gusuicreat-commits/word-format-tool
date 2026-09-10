"""File-bound, rule-bound structural confirmation without model calls."""
import argparse
from copy import deepcopy
import hashlib
import json
from pathlib import Path

import format_docx as f

ROLES = {"auto", "body", "paper_title", "heading_1", "heading_2", "heading_3",
         "table_caption", "figure_caption"}


def fingerprint(source, rules):
    public = {key: value for key, value in rules.items() if not key.startswith("_")}
    return {"input_sha256": hashlib.sha256(source.read_bytes()).hexdigest(),
            "rules_sha256": hashlib.sha256(json.dumps(public, sort_keys=True, ensure_ascii=False).encode()).hexdigest()}


def preview(source, rules):
    doc = f.open_document(source)
    original = f.analyze_document(doc)
    report = {"paragraphs": [], "warnings": []}
    f.format_normal_paragraphs(deepcopy(doc), deepcopy(rules), report)
    detected = {p["index"]: p for p in report["paragraphs"]}
    items = []
    for index, paragraph in enumerate(doc.paragraphs):
        if not paragraph.text.strip() and not paragraph._p.xpath('.//w:drawing | .//w:pict'):
            continue
        result = detected.get(index, {})
        items.append({"key": f"p:{index}", "text": paragraph.text[:240] or "[image]",
                      "detected": result.get("detected_type", "body"),
                      "locked": bool(result and result.get("applied_style") is None),
                      "needs_review": bool(result and result.get("applied_style") is None) or any(w.get("paragraph_index") == index for w in report["warnings"]),
                      "has_image": bool(paragraph._p.xpath('.//w:drawing | .//w:pict')),
                      "type": "auto", "preserve": False})
    for index, table in enumerate(f.iter_tables(doc.tables)):
        items.append({"key": f"t:{index}", "text": " | ".join(p.text for c in f.iter_unique_table_cells(table)
                     for p in c.paragraphs)[:240], "detected": "table", "locked": False,
                     "type": "auto", "preserve": False})
    return {"version": 1, **fingerprint(source, rules), "items": items,
            "section_count": len(original["sections"]), "layout": "not_performed"}


def validate_plan(plan, source, rules):
    if not isinstance(plan, dict) or plan.get("version") != 1:
        raise f.UserFacingError("结构确认数据无效，请重新分析。")
    if any(plan.get(k) != v for k, v in fingerprint(source, rules).items()):
        raise f.UserFacingError("文档或格式规则已改变，请重新分析并确认结构。")
    expected = {item["key"]: item for item in preview(source, rules)["items"]}
    items = plan.get("items")
    if not isinstance(items, list) or len(items) != len(expected):
        raise f.UserFacingError("结构确认条目不完整，请重新分析。")
    seen, result = set(), {"paragraphs": {}, "tables": set()}
    for item in items:
        if not isinstance(item, dict):
            raise f.UserFacingError("结构确认条目无效。")
        key, role, preserve = item.get("key"), item.get("type"), item.get("preserve")
        if not isinstance(key, str) or key not in expected or key in seen or not isinstance(role, str) or role not in ROLES or type(preserve) is not bool:
            raise f.UserFacingError("结构确认条目无效或重复。")
        seen.add(key)
        if (expected[key]["locked"] or key.startswith("t:")) and role != "auto":
            raise f.UserFacingError("受保护内容和表格不能指定段落类型。")
        index = int(key.split(":")[1])
        if key.startswith("p:"):
            result["paragraphs"][index] = {"type": role, "preserve": preserve}
        elif preserve:
            result["tables"].add(index)
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--template", default="default")
    parser.add_argument("--override")
    parser.add_argument("--report", required=True)
    parser.add_argument("--overwrite", action="store_true")
    parser.add_argument("--analyze", action="store_true")
    parser.add_argument("--review-plan", type=Path)
    args = parser.parse_args()
    f.validate_report_path(args.report, args.source, args.output)
    rules = f.get_final_format_rules(args.template, args.override, print_warnings=False)
    if args.analyze:
        f.save_report(preview(args.source, rules), args.report)
        return
    if args.review_plan is None:
        raise f.UserFacingError("请先确认文档结构。")
    plan = json.loads(args.review_plan.read_text(encoding="utf-8"))
    decisions = validate_plan(plan, args.source, rules)
    f.validate_paths(args.source, args.output, overwrite=args.overwrite)
    report = f.init_report(args.source, args.output, rules)
    f.format_document(args.source, args.output, rules, report, overwrite=args.overwrite, review=decisions)
    report["structure_confirmation"] = {**fingerprint(args.source, rules), "confirmed": True}
    f.save_report(report, args.report)


if __name__ == "__main__":
    try:
        main()
    except f.UserFacingError as exc:
        f.print_error(str(exc))
        raise SystemExit(2)
    except (ValueError, OSError) as exc:
        f.print_error(str(exc))
        raise SystemExit(1)
