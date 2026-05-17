import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH

import format_docx


PROJECT_ROOT = Path(__file__).resolve().parents[1]


def make_context():
    return {
        "first_non_empty_seen": True,
        "in_reference_section": False,
        "in_abstract_section": False,
        "stats": {},
    }


class CoreTests(unittest.TestCase):
    def test_detect_chinese_heading_1(self):
        result = format_docx.detect_paragraph_type("一、研究背景", 0, make_context())
        self.assertEqual(result, "heading_1")

    def test_detect_chinese_heading_2(self):
        result = format_docx.detect_paragraph_type("（一）研究意义", 0, make_context())
        self.assertEqual(result, "heading_2")

    def test_detect_number_heading_2(self):
        result = format_docx.detect_paragraph_type("1.1 研究现状", 0, make_context())
        self.assertEqual(result, "heading_2")

    def test_detect_table_caption(self):
        result = format_docx.detect_paragraph_type("表1 论文格式处理流程示例", 0, make_context())
        self.assertEqual(result, "table_caption")

    def test_detect_table_caption_with_space(self):
        result = format_docx.detect_paragraph_type("表 1 论文格式处理流程示例", 0, make_context())
        self.assertEqual(result, "table_caption")

    def test_detect_figure_caption(self):
        result = format_docx.detect_paragraph_type("图1 系统架构图", 0, make_context())
        self.assertEqual(result, "figure_caption")

    def test_detect_figure_caption_with_dash_number(self):
        result = format_docx.detect_paragraph_type("图 1-1 用户操作流程图", 0, make_context())
        self.assertEqual(result, "figure_caption")

    def test_reference_section_caption_like_text_stays_reference_item(self):
        context = make_context()
        context["in_reference_section"] = True
        result = format_docx.detect_paragraph_type("图1 系统架构图", 0, context)
        self.assertEqual(result, "reference_item")

    def test_normalize_font_size_xiaosi(self):
        self.assertEqual(format_docx.normalize_font_size("小四"), 12)

    def test_normalize_font_size_wuhao(self):
        self.assertEqual(format_docx.normalize_font_size("五号"), 10.5)

    def test_normalize_alignment_center(self):
        self.assertEqual(format_docx.normalize_alignment("居中"), "center")

    def test_normalize_alignment_justify(self):
        self.assertEqual(format_docx.normalize_alignment("两端对齐"), "justify")

    def test_normalize_line_spacing_one_point_five(self):
        self.assertEqual(format_docx.normalize_line_spacing("1.5倍"), 1.5)

    def test_normalize_line_spacing_single(self):
        self.assertEqual(format_docx.normalize_line_spacing("单倍行距"), 1.0)

    def test_normalize_indent_two_characters(self):
        self.assertEqual(format_docx.normalize_indent("2字符"), 24)

    def test_normalize_page_margin_cm_string(self):
        self.assertEqual(format_docx.normalize_page_margin("3cm"), 3)

    def test_normalize_color_black(self):
        self.assertEqual(format_docx.normalize_color("黑色"), "000000")

    def test_validate_format_rules_accepts_color(self):
        template = {
            "version": "1.0",
            "name": "test",
            "page": {},
            "styles": {"body": {"color": "000000"}},
        }
        errors, _ = format_docx.validate_format_rules(template)
        self.assertEqual(errors, [])

    def test_validate_format_rules_rejects_bad_color(self):
        template = {
            "version": "1.0",
            "name": "bad",
            "page": {},
            "styles": {"body": {"color": "black"}},
        }
        errors, _ = format_docx.validate_format_rules(template)
        self.assertTrue(any("styles.body.color" in error for error in errors))

    def test_apply_run_font_accepts_color(self):
        doc = Document()
        run = doc.add_paragraph().add_run("测试")
        format_docx.apply_run_font(
            run,
            {
                "font": "宋体",
                "size_pt": 12,
                "color": "000000",
                "bold": False,
                "italic": False,
            },
        )
        self.assertEqual(str(run.font.color.rgb), "000000")

    def test_validate_format_rules_accepts_valid_template(self):
        template = {
            "version": "1.0",
            "name": "test",
            "description": "测试模板",
            "page": {"top_margin_cm": 2.5},
            "styles": {
                "body": {
                    "font": "宋体",
                    "size_pt": 12,
                    "bold": False,
                    "alignment": "justify",
                    "line_spacing": 1.5,
                    "first_line_indent_pt": 24,
                    "space_before_pt": 0,
                    "space_after_pt": 0,
                }
            },
        }
        errors, warnings = format_docx.validate_format_rules(template)
        self.assertEqual(errors, [])
        self.assertEqual(warnings, [])

    def test_validate_format_rules_rejects_bad_size_pt(self):
        template = {
            "version": "1.0",
            "name": "bad",
            "page": {},
            "styles": {"body": {"size_pt": "12"}},
        }
        errors, _ = format_docx.validate_format_rules(template)
        self.assertTrue(any("styles.body.size_pt" in error for error in errors))

    def test_validate_format_rules_rejects_bad_alignment(self):
        template = {
            "version": "1.0",
            "name": "bad",
            "page": {},
            "styles": {"body": {"alignment": "middle"}},
        }
        errors, _ = format_docx.validate_format_rules(template)
        self.assertTrue(any("styles.body.alignment" in error for error in errors))

    def test_validate_override_rules_accepts_partial_body_font(self):
        override = {"styles": {"body": {"font": "微软雅黑"}}}
        normalized = format_docx.normalize_format_rules(override, fill_defaults=False)
        errors, _ = format_docx.validate_override_rules(normalized)
        self.assertEqual(errors, [])

    def test_validate_override_rules_does_not_require_page(self):
        errors, _ = format_docx.validate_override_rules({"styles": {"heading_1": {"font": "黑体"}}})
        self.assertEqual(errors, [])

    def test_validate_override_rules_does_not_require_styles_body(self):
        errors, _ = format_docx.validate_override_rules({"styles": {"heading_1": {"alignment": "center"}}})
        self.assertEqual(errors, [])

    def test_validate_override_rules_rejects_bad_alignment(self):
        errors, _ = format_docx.validate_override_rules({"styles": {"body": {"alignment": "middle"}}})
        self.assertTrue(any("styles.body.alignment" in error for error in errors))

    def test_merge_format_rules_overrides_body_font(self):
        base = format_docx.load_template("default")
        override = format_docx.normalize_format_rules(
            {"name": "teacher", "styles": {"body": {"font": "微软雅黑"}}},
            fill_defaults=False,
        )
        merged, metadata = format_docx.merge_format_rules(base, override)
        self.assertEqual(merged["styles"]["body"]["font"], "微软雅黑")
        self.assertIn("styles.body.font", metadata["overridden_fields"])

    def test_merge_format_rules_keeps_uncovered_fields(self):
        base = format_docx.load_template("default")
        base_line_spacing = base["styles"]["body"]["line_spacing"]
        override = format_docx.normalize_format_rules(
            {"name": "teacher", "styles": {"body": {"font": "微软雅黑"}}},
            fill_defaults=False,
        )
        merged, _ = format_docx.merge_format_rules(base, override)
        self.assertEqual(merged["styles"]["body"]["line_spacing"], base_line_spacing)

    def test_merge_format_rules_overrides_page_left_margin(self):
        base = format_docx.load_template("default")
        override = {"name": "teacher", "page": {"left_margin_cm": 3.2}}
        merged, metadata = format_docx.merge_format_rules(base, override)
        self.assertEqual(merged["page"]["left_margin_cm"], 3.2)
        self.assertIn("page.left_margin_cm", metadata["overridden_fields"])

    def test_merge_format_rules_does_not_mutate_base(self):
        base = format_docx.load_template("default")
        original_font = base["styles"]["body"]["font"]
        override = {"name": "teacher", "styles": {"body": {"font": "微软雅黑"}}}
        format_docx.merge_format_rules(base, override)
        self.assertEqual(base["styles"]["body"]["font"], original_font)

    def test_merge_format_rules_returns_overridden_fields(self):
        base = format_docx.load_template("default")
        override = format_docx.normalize_format_rules(
            {
                "name": "teacher",
                "styles": {
                    "body": {"font": "微软雅黑", "size_cn": "五号"},
                    "heading_1": {"alignment": "居中"},
                },
            },
            fill_defaults=False,
        )
        merged, metadata = format_docx.merge_format_rules(base, override)
        self.assertEqual(merged["styles"]["body"]["size_pt"], 10.5)
        self.assertIn("styles.body.font", metadata["overridden_fields"])
        self.assertIn("styles.body.size_pt", metadata["overridden_fields"])
        self.assertIn("styles.heading_1.alignment", metadata["overridden_fields"])

    def test_load_template_default(self):
        template = format_docx.load_template("default")
        self.assertEqual(template["name"], "default")
        self.assertIn("body", template["styles"])

    def test_validate_template_accepts_valid_template(self):
        template = {
            "version": "1.0",
            "name": "test",
            "page": {"top_margin_cm": 2.5},
            "styles": {
                "body": {
                    "font": "宋体",
                    "size_pt": 12,
                    "bold": False,
                    "alignment": "justify",
                    "line_spacing": 1.5,
                    "first_line_indent_pt": 24,
                    "space_before_pt": 0,
                    "space_after_pt": 0,
                }
            },
        }
        format_docx.validate_template(template)

    def test_validate_template_rejects_bad_style_type(self):
        template = {
            "version": "1.0",
            "name": "test",
            "page": {},
            "styles": {"body": {"size_pt": "12"}},
        }
        with self.assertRaises(format_docx.TemplateError):
            format_docx.validate_template(template)

    def test_validate_input_file_missing_raises(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            missing = Path(temp_dir) / "missing.docx"
            with self.assertRaises(format_docx.UserFacingError):
                format_docx.validate_input_file(missing)

    def test_validate_output_path_same_path_raises(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            input_path = Path(temp_dir) / "input.docx"
            input_path.write_bytes(b"fake")
            with self.assertRaises(format_docx.UserFacingError):
                format_docx.validate_output_path(input_path, input_path, overwrite=True)

    def test_make_text_preview_truncates(self):
        text = "这是一个用于测试截断功能的长文本" * 5
        preview = format_docx.make_text_preview(text, max_len=10)
        self.assertEqual(len(preview), 13)
        self.assertTrue(preview.endswith("..."))

    def test_save_report_generates_json(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            report_path = Path(temp_dir) / "reports" / "report.json"
            report = {
                "version": "test",
                "input_file": "in.docx",
                "output_file": "out.docx",
                "template": {"name": "default", "description": "test"},
                "stats": {},
                "paragraphs": [],
                "tables": [],
                "warnings": [],
            }
            format_docx.save_report(report, report_path)
            self.assertTrue(report_path.exists())
            data = json.loads(report_path.read_text(encoding="utf-8"))
            self.assertEqual(data["version"], "test")

    def test_old_flow_without_report_still_works(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_path = Path(temp_dir)
            input_path = temp_path / "input.docx"
            output_path = temp_path / "output.docx"

            doc = Document()
            doc.add_paragraph("测试论文标题")
            doc.add_paragraph("一、研究背景")
            doc.add_paragraph("这是一段用于测试旧流程的正文。")
            doc.save(str(input_path))

            result = subprocess.run(
                [
                    sys.executable,
                    str(PROJECT_ROOT / "format_docx.py"),
                    str(input_path),
                    str(output_path),
                    "--overwrite",
                ],
                cwd=str(PROJECT_ROOT),
                text=True,
                capture_output=True,
                check=False,
            )

            self.assertEqual(result.returncode, 0, msg=result.stderr)
            self.assertTrue(output_path.exists())
            self.assertFalse((temp_path / "report.json").exists())

    def test_validate_template_command_default_passes(self):
        result = subprocess.run(
            [
                sys.executable,
                str(PROJECT_ROOT / "format_docx.py"),
                "--validate-template",
                "templates/default.json",
            ],
            cwd=str(PROJECT_ROOT),
            text=True,
            capture_output=True,
            check=False,
        )

        self.assertEqual(result.returncode, 0, msg=result.stderr)
        self.assertIn("模板校验通过", result.stdout)

    def test_merge_rules_command_exports_final_rules(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            final_rules_path = Path(temp_dir) / "final_rules.json"
            result = subprocess.run(
                [
                    sys.executable,
                    str(PROJECT_ROOT / "format_docx.py"),
                    "--template",
                    "default",
                    "--override",
                    "overrides/teacher_override.json",
                    "--export-final-rules",
                    str(final_rules_path),
                    "--merge-rules",
                ],
                cwd=str(PROJECT_ROOT),
                text=True,
                capture_output=True,
                check=False,
            )

            self.assertEqual(result.returncode, 0, msg=result.stderr)
            self.assertTrue(final_rules_path.exists())
            final_rules = json.loads(final_rules_path.read_text(encoding="utf-8"))
            errors, _ = format_docx.validate_format_rules(final_rules)
            self.assertEqual(errors, [])

    def test_merge_rules_command_exports_debug_rules_for_margin_and_references(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_path = Path(temp_dir)
            override_path = temp_path / "override.json"
            debug_rules_path = temp_path / "debug_rules.json"
            override_path.write_text(
                json.dumps(
                    {
                        "name": "teacher",
                        "page": {"left_margin_cm": "3cm"},
                        "styles": {
                            "reference_title": {"alignment": "居中"},
                            "reference_item": {"font": "宋体", "size_cn": "五号"},
                        },
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )

            result = subprocess.run(
                [
                    sys.executable,
                    str(PROJECT_ROOT / "format_docx.py"),
                    "--template",
                    "default",
                    "--override",
                    str(override_path),
                    "--export-debug-rules",
                    str(debug_rules_path),
                    "--merge-rules",
                ],
                cwd=str(PROJECT_ROOT),
                text=True,
                capture_output=True,
                check=False,
            )

            self.assertEqual(result.returncode, 0, msg=result.stderr)
            debug_rules = json.loads(debug_rules_path.read_text(encoding="utf-8"))
            self.assertEqual(debug_rules["normalized_override"]["page"]["left_margin_cm"], 3)
            self.assertEqual(debug_rules["final_rules"]["page"]["left_margin_cm"], 3)
            self.assertEqual(
                debug_rules["final_rules"]["styles"]["reference_title"]["alignment"],
                "center",
            )
            self.assertNotEqual(
                debug_rules["final_rules"]["styles"]["reference_item"]["alignment"],
                "center",
            )

    def test_format_document_applies_left_margin_and_keeps_reference_item_left(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_path = Path(temp_dir)
            input_path = temp_path / "input.docx"
            output_path = temp_path / "output.docx"
            report_path = temp_path / "report.json"
            override_path = temp_path / "override.json"

            doc = Document()
            doc.add_paragraph("测试论文标题")
            doc.add_paragraph("参考文献")
            doc.add_paragraph("[1] 张三. 测试文献. 2024.")
            doc.save(str(input_path))

            override_path.write_text(
                json.dumps(
                    {
                        "name": "teacher",
                        "page": {"left_margin_cm": 3},
                        "styles": {
                            "reference_title": {"alignment": "center"},
                            "reference_item": {"font": "宋体", "size_cn": "五号"},
                        },
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )

            result = subprocess.run(
                [
                    sys.executable,
                    str(PROJECT_ROOT / "format_docx.py"),
                    str(input_path),
                    str(output_path),
                    "--template",
                    "default",
                    "--override",
                    str(override_path),
                    "--report",
                    str(report_path),
                    "--overwrite",
                ],
                cwd=str(PROJECT_ROOT),
                text=True,
                capture_output=True,
                check=False,
            )

            self.assertEqual(result.returncode, 0, msg=result.stderr)
            output_doc = Document(str(output_path))
            self.assertAlmostEqual(output_doc.sections[0].left_margin.cm, 3, places=2)
            self.assertEqual(output_doc.paragraphs[1].alignment, WD_ALIGN_PARAGRAPH.CENTER)
            self.assertNotEqual(output_doc.paragraphs[2].alignment, WD_ALIGN_PARAGRAPH.CENTER)

            report = json.loads(report_path.read_text(encoding="utf-8"))
            self.assertEqual(
                report["final_rules_debug"]["final_rules"]["page"]["left_margin_cm"],
                3,
            )
            reference_item = report["final_rules_debug"]["final_rules"]["styles"][
                "reference_item"
            ]
            self.assertNotEqual(reference_item["alignment"], "center")
            self.assertEqual(report["paragraphs"][1]["detected_type"], "reference_title")
            self.assertEqual(report["paragraphs"][2]["detected_type"], "reference_item")
            self.assertEqual(report["paragraphs"][2]["applied_style"], "reference_item")


if __name__ == "__main__":
    unittest.main()
