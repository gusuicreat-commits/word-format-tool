"""文格 Lite V2.4.2：本地版 Word 论文格式修改器。

用法：
    python format_docx.py input.docx output.docx --overwrite
    python format_docx.py input.docx output.docx --template default --report reports/report.json --overwrite
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import tempfile
import traceback
from copy import deepcopy
from json import JSONDecodeError
from pathlib import Path

try:
    from docx import Document
    from docx.enum.text import WD_ALIGN_PARAGRAPH
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn
    from docx.shared import Cm, Pt, RGBColor
except ImportError:
    Document = None
    WD_ALIGN_PARAGRAPH = None
    OxmlElement = None
    qn = None
    Cm = None
    Pt = None
    RGBColor = None


BASE_DIR = Path(__file__).resolve().parent
DEFAULT_TEMPLATE_PATH = BASE_DIR / "templates" / "default.json"
VERSION = "V2.4.2"

CHINESE_NUMBER = "一二三四五六七八九十"
PROTECTED_FIRST_PARAGRAPHS = {
    "摘要",
    "摘要：",
    "摘要:",
    "关键词",
    "关键词：",
    "关键词:",
    "目录",
    "参考文献",
    "参考文献：",
    "参考文献:",
}
SENTENCE_ENDING_PUNCTUATION = "。？！?!.！"
ALLOWED_ALIGNMENTS = {"left", "center", "right", "justify"}
PAGE_MARGIN_FIELDS = [
    "top_margin_cm",
    "bottom_margin_cm",
    "left_margin_cm",
    "right_margin_cm",
]
TABLE_CAPTION_PATTERN = re.compile(r"^表\s*\d+([-.－—]\d+)?[\.．、\s]*\S+")
FIGURE_CAPTION_PATTERN = re.compile(r"^图\s*\d+([-.－—]\d+)?[\.．、\s]*\S+")

SUPPORTED_STYLE_TYPES = [
    "paper_title",
    "abstract_title",
    "abstract_content",
    "keywords",
    "heading_1",
    "heading_2",
    "heading_3",
    "body",
    "table_caption",
    "figure_caption",
    "reference_title",
    "reference_item",
    "table_text",
]

ALLOWED_STYLE_FIELDS = {
    "font",
    "size_pt",
    "size_cn",
    "color",
    "bold",
    "italic",
    "alignment",
    "line_spacing",
    "first_line_indent_pt",
    "space_before_pt",
    "space_after_pt",
}

COLOR_MAP = {
    "黑色": "000000",
    "黑": "000000",
    "红色": "FF0000",
    "红": "FF0000",
    "蓝色": "0000FF",
    "蓝": "0000FF",
}
COLOR_PATTERN = re.compile(r"^[0-9A-Fa-f]{6}$")

CHINESE_FONT_SIZE_MAP = {
    "初号": 42,
    "小初": 36,
    "一号": 26,
    "小一": 24,
    "二号": 22,
    "小二": 18,
    "三号": 16,
    "小三": 15,
    "四号": 14,
    "小四": 12,
    "五号": 10.5,
    "小五": 9,
    "六号": 7.5,
    "小六": 6.5,
    "七号": 5.5,
    "八号": 5,
}

ALIGNMENT_MAP = {
    "左对齐": "left",
    "居中": "center",
    "居中对齐": "center",
    "右对齐": "right",
    "两端对齐": "justify",
    "分散对齐": "justify",
}

REPORT_STAT_KEYS = [
    "paper_title",
    "abstract_title",
    "abstract_content",
    "keywords",
    "heading_1",
    "heading_2",
    "heading_3",
    "table_caption",
    "figure_caption",
    "body",
    "reference_title",
    "reference_item",
    "table",
    "style_fallback_count",
    "warning_count",
]

DEFAULT_STYLE = {
    "font": "宋体",
    "size_pt": 12,
    "color": "000000",
    "bold": False,
    "italic": False,
    "alignment": "left",
    "line_spacing": 1.5,
    "first_line_indent_pt": 0,
    "space_before_pt": 0,
    "space_after_pt": 0,
}


class UserFacingError(Exception):
    """可以直接展示给普通用户的错误。"""


class TemplateError(UserFacingError):
    """模板读取或校验失败。"""


class ReportError(UserFacingError):
    """报告保存失败。"""


def parse_args(argv=None) -> argparse.Namespace:
    """解析命令行参数。"""
    parser = argparse.ArgumentParser(
        description="文格 Lite V2.4.2：基于规则识别段落，按 JSON 模板修改 .docx，并可生成处理报告。"
    )
    parser.add_argument("input_docx", nargs="?", help="输入 Word 文件路径，例如 samples/input.docx")
    parser.add_argument("output_docx", nargs="?", help="输出 Word 文件路径，例如 samples/output.docx")
    parser.add_argument(
        "--template",
        default=None,
        help="模板名称或路径，例如 default、course_paper 或 templates/default.json",
    )
    parser.add_argument(
        "--report",
        default=None,
        help="可选的 JSON 报告路径，例如 reports/report.json",
    )
    parser.add_argument(
        "--overwrite",
        action="store_true",
        help="允许覆盖已经存在的输出 .docx 文件",
    )
    parser.add_argument(
        "--debug",
        action="store_true",
        help="出错时显示 Python traceback，方便开发者调试",
    )
    parser.add_argument(
        "--validate-template",
        default=None,
        help="只校验模板 JSON，不处理 Word，例如 templates/default.json",
    )
    parser.add_argument(
        "--override",
        default=None,
        help="可选的局部覆盖规则 JSON，例如 overrides/teacher_override.json",
    )
    parser.add_argument(
        "--export-final-rules",
        default=None,
        help="可选：导出基础模板和覆盖规则合并后的最终完整规则 JSON",
    )
    parser.add_argument(
        "--export-debug-rules",
        default=None,
        help="可选：导出规则调试 JSON，包含原始覆盖、规范化覆盖、最终规则和调试摘要",
    )
    parser.add_argument(
        "--merge-rules",
        action="store_true",
        help="只合并模板和覆盖规则，不处理 Word，通常配合 --export-final-rules 使用",
    )
    return parser.parse_args(argv)


def print_error(message: str) -> None:
    """统一输出中文错误提示。"""
    print(f"错误：{message}", file=sys.stderr)


def ensure_dependency_installed() -> None:
    """检查 python-docx 是否已经安装。"""
    if Document is None:
        raise UserFacingError("缺少依赖 python-docx，请先运行：pip install -r requirements.txt")


def validate_input_file(input_path: Path) -> None:
    """校验输入文件。"""
    if not input_path.exists():
        raise UserFacingError(f"输入文件不存在：{input_path}")

    if not input_path.is_file():
        raise UserFacingError(f"输入路径不是文件：{input_path}")

    suffix = input_path.suffix.lower()
    if suffix == ".doc":
        raise UserFacingError(
            "当前仅支持 .docx 文件，不支持 .doc。请先用 Word/WPS 另存为 .docx 后再试。"
        )

    if suffix != ".docx":
        raise UserFacingError("输入文件必须是 .docx 格式。")

    try:
        if input_path.stat().st_size == 0:
            raise UserFacingError("输入文件为空，无法处理。")
    except OSError as exc:
        raise UserFacingError("无法读取输入文件，请检查文件权限。") from exc

    try:
        with input_path.open("rb") as file:
            file.read(1)
    except OSError as exc:
        raise UserFacingError("无法读取输入文件，请检查文件权限。") from exc


def validate_output_path(
    input_path: Path, output_path: Path, overwrite: bool = False
) -> None:
    """校验输出路径，并在需要时创建输出目录。"""
    if output_path.exists() and output_path.is_dir():
        raise UserFacingError(f"输出路径不能是文件夹：{output_path}")

    if output_path.suffix.lower() != ".docx":
        raise UserFacingError("输出文件名必须以 .docx 结尾。")

    if input_path.resolve() == output_path.resolve():
        raise UserFacingError("为了避免覆盖原文件，输出文件不能和输入文件相同。")

    output_dir = output_path.parent
    if output_dir and not output_dir.exists():
        try:
            output_dir.mkdir(parents=True, exist_ok=True)
        except OSError as exc:
            raise UserFacingError(f"无法创建输出目录：{output_dir}。请检查路径和权限。") from exc

    if output_dir and not output_dir.is_dir():
        raise UserFacingError(f"输出目录不是文件夹：{output_dir}")

    if output_path.exists() and not overwrite:
        raise UserFacingError(f"输出文件已存在：{output_path}\n如需覆盖，请添加 --overwrite 参数。")


def validate_paths(input_path: Path, output_path: Path, overwrite: bool = False) -> None:
    """兼容旧调用：同时校验输入文件和输出路径。"""
    validate_input_file(input_path)
    validate_output_path(input_path, output_path, overwrite=overwrite)


def resolve_template_path(template_arg: str | None) -> Path:
    """把模板参数解析成具体 JSON 文件路径。"""
    if not template_arg:
        return DEFAULT_TEMPLATE_PATH

    arg_path = Path(template_arg)
    if arg_path.suffix.lower() == ".json":
        return arg_path if arg_path.is_absolute() else BASE_DIR / arg_path

    return BASE_DIR / "templates" / f"{template_arg}.json"


def read_template_json(template_path: Path):
    """读取模板 JSON 文件，并把常见读取错误转换成中文提示。"""
    if not template_path.exists():
        raise TemplateError(f"模板文件不存在：{template_path}")

    if not template_path.is_file():
        raise TemplateError(f"模板路径不是文件：{template_path}")

    try:
        with template_path.open("r", encoding="utf-8") as file:
            template = json.load(file)
    except JSONDecodeError as exc:
        raise TemplateError(
            "模板 JSON 格式不正确，请检查是否缺少逗号、引号或括号。"
            f"文件：{template_path}，第 {exc.lineno} 行第 {exc.colno} 列。"
        ) from exc
    except OSError as exc:
        raise TemplateError(f"读取模板失败：{template_path}，请检查文件权限。") from exc

    return template


def is_number(value) -> bool:
    """bool 在 Python 中是 int 的子类，这里显式排除。"""
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def normalize_font_size(size_cn: str) -> int | float:
    """把中文字号转换成磅值，例如“小四”转换为 12。"""
    if not isinstance(size_cn, str):
        raise TemplateError("中文字号 size_cn 应为字符串，例如“小四”。")

    normalized = size_cn.strip()
    if normalized not in CHINESE_FONT_SIZE_MAP:
        raise TemplateError(f"未知中文字号：{size_cn}。")
    return CHINESE_FONT_SIZE_MAP[normalized]


def normalize_alignment(alignment) -> str:
    """把中文对齐方式转换成内部英文枚举。"""
    if not isinstance(alignment, str):
        raise TemplateError("alignment 应为字符串，例如 center 或 居中。")

    normalized = alignment.strip()
    if normalized in ALIGNMENT_MAP:
        return ALIGNMENT_MAP[normalized]
    if normalized in ALLOWED_ALIGNMENTS:
        return normalized
    raise TemplateError("alignment 只能是 left、center、right、justify，或支持的中文写法。")


def normalize_color(color):
    """把常见中文颜色转换成 6 位十六进制颜色值。"""
    if not isinstance(color, str):
        return color

    normalized = color.strip()
    if normalized in COLOR_MAP:
        return COLOR_MAP[normalized]

    if normalized.startswith("#"):
        normalized = normalized[1:]

    if COLOR_PATTERN.match(normalized):
        return normalized.upper()

    return normalized


def normalize_line_spacing(value) -> int | float:
    """把常见行距写法转换成数字。"""
    if is_number(value):
        return value
    if not isinstance(value, str):
        raise TemplateError("line_spacing 应为数字，或类似“1.5倍”“单倍行距”的字符串。")

    normalized = value.strip()
    spacing_map = {
        "单倍": 1.0,
        "单倍行距": 1.0,
        "双倍": 2.0,
        "双倍行距": 2.0,
    }
    if normalized in spacing_map:
        return spacing_map[normalized]

    number_match = re.match(r"^(\d+(?:\.\d+)?)\s*(?:倍|倍行距)?$", normalized)
    if number_match:
        return float(number_match.group(1))

    raise TemplateError(f"无法识别行距写法：{value}。")


def normalize_indent(value) -> int | float:
    """把首行缩进常见写法转换成磅值，约定 1 个中文字符为 12 磅。"""
    if is_number(value):
        return value
    if not isinstance(value, str):
        raise TemplateError("first_line_indent_pt 应为数字，或类似“2字符”“不缩进”的字符串。")

    normalized = value.strip()
    if normalized in {"无", "不缩进"}:
        return 0
    if normalized == "两个字符":
        return 24

    character_match = re.match(r"^(\d+(?:\.\d+)?)\s*字符$", normalized)
    if character_match:
        return float(character_match.group(1)) * 12

    number_match = re.match(r"^\d+(?:\.\d+)?$", normalized)
    if number_match:
        return float(normalized)

    raise TemplateError(f"无法识别首行缩进写法：{value}。")


def normalize_page_margin(value) -> int | float:
    """把页边距写法转换成厘米数字，例如 3cm 转换为 3。"""
    if is_number(value):
        return value
    if not isinstance(value, str):
        raise TemplateError("页边距应为数字，或类似“3cm”“3厘米”的字符串。")

    normalized = value.strip().lower()
    match = re.match(r"^(\d+(?:\.\d+)?)\s*(?:cm|厘米|公分)?$", normalized)
    if not match:
        raise TemplateError(f"无法识别页边距写法：{value}。")

    margin = float(match.group(1))
    return int(margin) if margin.is_integer() else margin


def normalize_format_rules(template, fill_defaults=True):
    """把模板中的中文表达和非标准表达转换成内部标准格式。"""
    if not isinstance(template, dict):
        return template

    normalized_template = deepcopy(template)
    warnings = []

    page = normalized_template.get("page")
    if isinstance(page, dict):
        normalized_page = dict(page)
        for field in PAGE_MARGIN_FIELDS:
            if field in normalized_page:
                normalized_page[field] = normalize_page_margin(normalized_page[field])
        normalized_template["page"] = normalized_page

    styles = normalized_template.get("styles")
    if not isinstance(styles, dict):
        normalized_template["_template_warnings"] = warnings
        return normalized_template

    for style_name, style_config in list(styles.items()):
        if not isinstance(style_config, dict):
            continue

        normalized_style = dict(style_config)

        if "size_cn" in normalized_style:
            size_cn_value = normalized_style["size_cn"]
            size_cn_pt = normalize_font_size(size_cn_value)
            if "size_pt" in normalized_style and is_number(normalized_style["size_pt"]):
                if abs(float(normalized_style["size_pt"]) - float(size_cn_pt)) > 0.01:
                    warnings.append(
                        f"模板样式 {style_name} 中 size_cn={size_cn_value} 与 "
                        f"size_pt={normalized_style['size_pt']} 不一致，已优先使用 size_pt。"
                    )
            elif "size_pt" not in normalized_style:
                normalized_style["size_pt"] = size_cn_pt

        if "alignment" in normalized_style:
            normalized_style["alignment"] = normalize_alignment(
                normalized_style["alignment"]
            )

        if "color" in normalized_style:
            normalized_style["color"] = normalize_color(normalized_style["color"])

        if "line_spacing" in normalized_style:
            normalized_style["line_spacing"] = normalize_line_spacing(
                normalized_style["line_spacing"]
            )

        if "first_line_indent_pt" in normalized_style:
            normalized_style["first_line_indent_pt"] = normalize_indent(
                normalized_style["first_line_indent_pt"]
            )

        if fill_defaults:
            for field, default_value in DEFAULT_STYLE.items():
                normalized_style.setdefault(field, default_value)

            normalized_style.setdefault("space_before_pt", DEFAULT_STYLE["space_before_pt"])
            normalized_style.setdefault("space_after_pt", DEFAULT_STYLE["space_after_pt"])
        styles[style_name] = normalized_style

    normalized_template["_template_warnings"] = warnings
    return normalized_template


def validate_format_rules(template):
    """检查规范化后的模板是否合法，返回 errors 和 warnings。"""
    errors = []
    warnings = []

    if not isinstance(template, dict):
        return ["模板内容必须是一个 JSON 对象。"], warnings

    if "version" in template and not isinstance(template["version"], str):
        errors.append("模板字段 version 应为字符串，例如 1.0。")

    if "name" not in template or not isinstance(template.get("name"), str):
        errors.append("模板缺少必要字段 name，且 name 应为字符串。")

    if "description" in template and not isinstance(template["description"], str):
        errors.append("模板字段 description 应为字符串。")

    has_structural_error = False

    if "page" not in template:
        errors.append("模板缺少必要字段 page。")
        has_structural_error = True

    if "styles" not in template:
        errors.append("模板缺少必要字段 styles。")
        has_structural_error = True

    if "page" in template and not isinstance(template["page"], dict):
        errors.append("模板字段 page 应为对象。")
        has_structural_error = True

    if "styles" in template and not isinstance(template["styles"], dict):
        errors.append("模板字段 styles 应为对象。")
        has_structural_error = True

    if has_structural_error:
        return errors, warnings

    if "body" not in template["styles"]:
        errors.append("模板缺少必要字段 styles.body。")

    for field in PAGE_MARGIN_FIELDS:
        if field in template["page"] and not is_number(template["page"][field]):
            errors.append(f"模板字段 page.{field} 应为数字，例如 2.5。")

    for style_name, style_config in template["styles"].items():
        if style_name not in SUPPORTED_STYLE_TYPES:
            warnings.append(
                f"模板包含未知样式类型：{style_name}，将被忽略或保留但不会被规则识别使用。"
            )

        if not isinstance(style_config, dict):
            errors.append(f"模板字段 styles.{style_name} 应为对象。")
            continue

        style_errors, style_warnings = validate_style_config(style_name, style_config)
        errors.extend(style_errors)
        warnings.extend(style_warnings)

    return errors, warnings


def validate_template(template) -> None:
    """兼容旧调用：发现模板错误时直接抛出异常。"""
    errors, _ = validate_format_rules(template)
    if errors:
        raise TemplateError("模板校验失败：\n- " + "\n- ".join(errors))


def validate_override_rules(override):
    """校验局部覆盖规则。override 可以只包含 page 或 styles 的部分字段。"""
    errors = []
    warnings = []

    if not isinstance(override, dict):
        return ["自定义覆盖规则必须是一个 JSON 对象。"], warnings

    if "version" in override and not isinstance(override["version"], str):
        errors.append("自定义覆盖规则字段 version 应为字符串。")

    if "name" in override and not isinstance(override["name"], str):
        errors.append("自定义覆盖规则字段 name 应为字符串。")

    if "description" in override and not isinstance(override["description"], str):
        errors.append("自定义覆盖规则字段 description 应为字符串。")

    has_page = "page" in override
    has_styles = "styles" in override
    if not has_page and not has_styles:
        warnings.append("自定义覆盖规则中没有 page 或 styles，不会产生实际覆盖效果。")

    if has_page:
        if not isinstance(override["page"], dict):
            errors.append("自定义覆盖规则字段 page 应为对象。")
        else:
            for field in PAGE_MARGIN_FIELDS:
                if field in override["page"] and not is_number(override["page"][field]):
                    errors.append(f"自定义覆盖规则字段 page.{field} 应为数字，例如 2.5。")

    if has_styles:
        if not isinstance(override["styles"], dict):
            errors.append("自定义覆盖规则字段 styles 应为对象。")
        else:
            for style_name, style_config in override["styles"].items():
                if style_name not in SUPPORTED_STYLE_TYPES:
                    warnings.append(
                        f"自定义覆盖规则包含未知样式类型：{style_name}，将被忽略。"
                    )

                if not isinstance(style_config, dict):
                    errors.append(f"自定义覆盖规则字段 styles.{style_name} 应为对象。")
                    continue

                style_errors, style_warnings = validate_style_config(style_name, style_config)
                errors.extend(
                    error.replace("模板字段", "自定义覆盖规则字段")
                    for error in style_errors
                )
                warnings.extend(
                    warning.replace("模板字段", "自定义覆盖规则字段")
                    for warning in style_warnings
                )

    return errors, warnings


def validate_style_config(style_name: str, style_config: dict):
    """检查单个样式配置的字段类型。"""
    errors = []
    warnings = []
    field_path = f"styles.{style_name}"

    for field in style_config:
        if field not in ALLOWED_STYLE_FIELDS:
            warnings.append(f"模板字段 {field_path}.{field} 不是标准样式字段，将被保留但不会被使用。")

    if "font" in style_config and not isinstance(style_config["font"], str):
        errors.append(f"模板字段 {field_path}.font 应为字符串，例如 \"宋体\"。")

    if "color" in style_config:
        color = style_config["color"]
        if not isinstance(color, str) or not COLOR_PATTERN.match(color):
            errors.append(
                f"模板字段 {field_path}.color 应为 6 位十六进制颜色值，例如 000000。"
            )

    if "size_pt" in style_config and not is_number(style_config["size_pt"]):
        errors.append(f"模板字段 {field_path}.size_pt 应为数字，例如 12。")

    if "size_cn" in style_config:
        size_cn = style_config["size_cn"]
        if not isinstance(size_cn, str):
            errors.append(f"模板字段 {field_path}.size_cn 应为字符串，例如 \"小四\"。")
        elif size_cn.strip() not in CHINESE_FONT_SIZE_MAP:
            errors.append(f"模板字段 {field_path}.size_cn 使用了未知中文字号：{size_cn}。")

    if "bold" in style_config and not isinstance(style_config["bold"], bool):
        errors.append(f"模板字段 {field_path}.bold 应为布尔值 true 或 false。")

    if "italic" in style_config and not isinstance(style_config["italic"], bool):
        errors.append(f"模板字段 {field_path}.italic 应为布尔值 true 或 false。")

    if "alignment" in style_config:
        alignment = style_config["alignment"]
        if not isinstance(alignment, str) or alignment not in ALLOWED_ALIGNMENTS:
            errors.append(
                f"模板字段 {field_path}.alignment 只能是 left、center、right、justify。"
            )

    numeric_fields = [
        "line_spacing",
        "first_line_indent_pt",
        "space_before_pt",
        "space_after_pt",
    ]
    for field in numeric_fields:
        if field in style_config and not is_number(style_config[field]):
            errors.append(f"模板字段 {field_path}.{field} 应为数字。")

    return errors, warnings


def prepare_template(template_arg, print_warnings=True):
    """读取、规范化并校验模板，返回可用于排版的标准模板。"""
    template_path = resolve_template_path(template_arg)
    raw_template = read_template_json(template_path)
    normalized_template = normalize_format_rules(raw_template)
    normalization_warnings = normalized_template.get("_template_warnings", [])
    errors, validation_warnings = validate_format_rules(normalized_template)
    template_warnings = normalization_warnings + validation_warnings

    if errors:
        raise TemplateError("模板校验失败：\n- " + "\n- ".join(errors))

    normalized_template["_template_path"] = str(template_path)
    normalized_template["_template_warnings"] = template_warnings
    normalized_template["_runtime"] = {
        "fallback_count": 0,
        "warned_missing_styles": set(),
    }

    if print_warnings:
        for warning in template_warnings:
            print(f"警告：{warning}")

    return normalized_template


def load_template(template_arg):
    """读取模板配置，并执行规范化与校验。"""
    return prepare_template(template_arg, print_warnings=True)


def resolve_override_path(override_path: str | None) -> Path | None:
    """把 override 参数解析成具体 JSON 路径。"""
    if not override_path:
        return None

    path = Path(override_path)
    return path if path.is_absolute() else BASE_DIR / path


def read_override_json(override_path):
    """读取覆盖规则 JSON，返回原始对象和实际路径。"""
    path = resolve_override_path(override_path)
    if path is None:
        return None, None

    if not path.exists():
        raise UserFacingError(f"自定义覆盖规则文件不存在：{path}")

    if not path.is_file():
        raise UserFacingError(f"自定义覆盖规则路径不是文件：{path}")

    try:
        with path.open("r", encoding="utf-8") as file:
            raw_override = json.load(file)
    except JSONDecodeError as exc:
        raise UserFacingError(
            f"自定义覆盖规则 JSON 格式不正确：{path}，第 {exc.lineno} 行第 {exc.colno} 列。"
        ) from exc
    except OSError as exc:
        raise UserFacingError(f"读取自定义覆盖规则失败：{path}，请检查文件权限。") from exc

    return raw_override, path


def normalize_override_rules(raw_override, path: Path | None = None):
    """规范化并校验局部覆盖规则。"""
    try:
        normalized_override = normalize_format_rules(raw_override, fill_defaults=False)
    except TemplateError as exc:
        raise UserFacingError(f"自定义覆盖规则规范化失败：{exc}") from exc

    normalization_warnings = normalized_override.get("_template_warnings", [])
    errors, validation_warnings = validate_override_rules(normalized_override)
    warnings = normalization_warnings + validation_warnings

    if errors:
        raise UserFacingError("自定义覆盖规则校验失败：\n- " + "\n- ".join(errors))

    normalized_override["_override_path"] = str(path or "")
    normalized_override["_override_warnings"] = warnings
    return normalized_override


def load_override_rules(override_path):
    """读取、规范化并校验局部覆盖规则。"""
    raw_override, path = read_override_json(override_path)
    if raw_override is None:
        return None
    return normalize_override_rules(raw_override, path)


def merge_format_rules(base_rules, override_rules):
    """深度合并基础模板和局部覆盖规则，并记录覆盖字段。"""
    if override_rules is None:
        return deepcopy(base_rules), {
            "enabled": False,
            "overridden_fields": [],
            "warnings": [],
        }

    merged = deepcopy(base_rules)
    overridden_fields = []
    warnings = list(override_rules.get("_override_warnings", []))

    override_page = override_rules.get("page")
    if isinstance(override_page, dict):
        merged.setdefault("page", {})
        for field, value in override_page.items():
            merged["page"][field] = value
            overridden_fields.append(f"page.{field}")

    override_styles = override_rules.get("styles")
    if isinstance(override_styles, dict):
        merged.setdefault("styles", {})
        for style_name, style_config in override_styles.items():
            if style_name not in SUPPORTED_STYLE_TYPES:
                warnings.append(f"自定义覆盖规则包含未知样式类型：{style_name}，已忽略。")
                continue
            if not isinstance(style_config, dict):
                continue

            merged["styles"].setdefault(style_name, {})
            for field, value in style_config.items():
                if field == "size_cn":
                    continue
                if field.startswith("_"):
                    continue
                merged["styles"][style_name][field] = value
                overridden_fields.append(f"styles.{style_name}.{field}")

    base_name = base_rules.get("name", "base")
    override_name = override_rules.get("name", "override")
    base_description = base_rules.get("description", base_name)
    override_description = override_rules.get("description", override_name)

    merged["name"] = f"{base_name}_with_{override_name}"
    merged["description"] = f"{base_description} + {override_description}"
    merged["version"] = base_rules.get("version", "1.0")

    normalized_merged = normalize_format_rules(merged, fill_defaults=True)
    errors, validation_warnings = validate_format_rules(normalized_merged)
    warnings.extend(normalized_merged.get("_template_warnings", []))
    warnings.extend(validation_warnings)
    warnings = list(dict.fromkeys(warnings))

    if errors:
        raise UserFacingError("最终格式规则校验失败：\n- " + "\n- ".join(errors))

    normalized_merged["_template_path"] = base_rules.get("_template_path")
    normalized_merged["_template_warnings"] = list(
        dict.fromkeys(list(base_rules.get("_template_warnings", [])) + warnings)
    )
    normalized_merged["_runtime"] = {
        "fallback_count": 0,
        "warned_missing_styles": set(),
    }
    normalized_merged["_base_template"] = {
        "name": base_rules.get("name", ""),
        "description": base_rules.get("description", ""),
        "path": base_rules.get("_template_path", ""),
    }
    normalized_merged["_override"] = {
        "enabled": True,
        "path": override_rules.get("_override_path", ""),
        "name": override_rules.get("name", ""),
        "description": override_rules.get("description", ""),
        "overridden_fields": overridden_fields,
        "warnings": warnings,
        "warning_count": len(warnings),
    }
    normalized_merged["_final_rules"] = {
        "name": normalized_merged.get("name", ""),
        "description": normalized_merged.get("description", ""),
    }

    return normalized_merged, normalized_merged["_override"]


def get_final_format_rules(template_arg=None, override_path=None, print_warnings=True):
    """加载基础模板和可选 override，返回最终可执行格式规则。"""
    base_rules = prepare_template(template_arg, print_warnings=print_warnings)
    if not override_path:
        base_rules["_base_template"] = {
            "name": base_rules.get("name", ""),
            "description": base_rules.get("description", ""),
            "path": base_rules.get("_template_path", ""),
        }
        base_rules["_override"] = {"enabled": False}
        base_rules["_final_rules"] = {
            "name": base_rules.get("name", ""),
            "description": base_rules.get("description", ""),
        }
        base_rules["_raw_override"] = None
        base_rules["_normalized_override"] = None
        return base_rules

    raw_override, resolved_override_path = read_override_json(override_path)
    override_rules = normalize_override_rules(raw_override, resolved_override_path)
    final_rules, override_metadata = merge_format_rules(base_rules, override_rules)
    final_rules["_raw_override"] = raw_override
    final_rules["_normalized_override"] = override_rules

    if print_warnings:
        for warning in override_metadata.get("warnings", []):
            print(f"警告：{warning}")

    return final_rules


def clean_format_rules_for_export(rules):
    """移除运行期私有字段，生成可导出的完整规则 JSON。"""
    def clean_value(value):
        if isinstance(value, dict):
            return {
                key: clean_value(item)
                for key, item in value.items()
                if not str(key).startswith("_") and key != "size_cn"
            }
        if isinstance(value, list):
            return [clean_value(item) for item in value]
        if isinstance(value, set):
            return sorted(value)
        return value

    return clean_value(rules)


def export_final_rules(rules, export_path):
    """导出最终完整格式规则 JSON。"""
    path = Path(export_path)
    if path.exists() and path.is_dir():
        raise UserFacingError(f"最终规则导出路径不能是文件夹：{path}")

    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("w", encoding="utf-8") as file:
            json.dump(clean_format_rules_for_export(rules), file, ensure_ascii=False, indent=2)
            file.write("\n")
    except OSError as exc:
        raise UserFacingError(f"保存最终规则失败：{path}，请检查目录写入权限。") from exc


def get_nested_value(data, dotted_path: str):
    """按 a.b.c 路径从字典里取值，用于调试摘要。"""
    current = data
    for part in dotted_path.split("."):
        if not isinstance(current, dict) or part not in current:
            return None
        current = current[part]
    return current


def build_debug_summary(rules) -> dict:
    """生成关键规则链路摘要，便于定位覆盖是否进入最终规则。"""
    final_rules = clean_format_rules_for_export(rules)
    override_metadata = rules.get("_override", {"enabled": False})
    overridden_fields = override_metadata.get("overridden_fields", [])
    return {
        "override_enabled": bool(override_metadata.get("enabled")),
        "overridden_field_count": len(overridden_fields),
        "overridden_fields": [
            {
                "field": field,
                "final_value": get_nested_value(final_rules, field),
            }
            for field in overridden_fields
        ],
        "page_left_margin_cm": get_nested_value(final_rules, "page.left_margin_cm"),
        "reference_title_alignment": get_nested_value(
            final_rules,
            "styles.reference_title.alignment",
        ),
        "reference_item_alignment": get_nested_value(
            final_rules,
            "styles.reference_item.alignment",
        ),
    }


def build_rules_debug_payload(rules) -> dict:
    """生成规则调试 JSON，覆盖 raw -> normalized -> final 的主链路。"""
    normalized_override = rules.get("_normalized_override")
    return {
        "base_template": rules.get("_base_template", {}),
        "override": rules.get("_override", {"enabled": False}),
        "raw_override": rules.get("_raw_override"),
        "normalized_override": (
            clean_format_rules_for_export(normalized_override)
            if isinstance(normalized_override, dict)
            else None
        ),
        "final_rules": clean_format_rules_for_export(rules),
        "debug_summary": build_debug_summary(rules),
    }


def export_debug_rules(rules, export_path):
    """导出规则调试 JSON。"""
    path = Path(export_path)
    if path.exists() and path.is_dir():
        raise UserFacingError(f"规则调试导出路径不能是文件夹：{path}")

    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("w", encoding="utf-8") as file:
            json.dump(build_rules_debug_payload(rules), file, ensure_ascii=False, indent=2)
            file.write("\n")
    except OSError as exc:
        raise UserFacingError(f"保存规则调试信息失败：{path}，请检查目录写入权限。") from exc


def count_override_fields(rules) -> int:
    """返回 override 实际覆盖字段数量。"""
    return len(rules.get("_override", {}).get("overridden_fields", []))


def init_report(input_path, output_path, template):
    """初始化格式处理报告对象。"""
    template_warnings = list(template.get("_template_warnings", []))
    override_metadata = template.get("_override", {"enabled": False})
    return {
        "version": VERSION,
        "input_file": str(input_path),
        "output_file": str(output_path),
        "template": {
            "name": template.get("name", "未命名模板"),
            "description": template.get("description", "无"),
        },
        "base_template": template.get(
            "_base_template",
            {
                "name": template.get("name", "未命名模板"),
                "description": template.get("description", "无"),
                "path": template.get("_template_path", ""),
            },
        ),
        "override": override_metadata,
        "final_rules": template.get(
            "_final_rules",
            {
                "name": template.get("name", "未命名模板"),
                "description": template.get("description", "无"),
            },
        ),
        "final_rules_debug": build_rules_debug_payload(template),
        "stats": {key: 0 for key in REPORT_STAT_KEYS},
        "paragraphs": [],
        "tables": [],
        "template_warnings": template_warnings,
        "warnings": [
            {
                "paragraph_index": None,
                "text_preview": "",
                "message": warning,
            }
            for warning in template_warnings
        ],
    }


def make_text_preview(text, max_len=50):
    """生成报告中的文本预览，最多保留 max_len 个字符。"""
    clean_text = (text or "").strip()
    if len(clean_text) <= max_len:
        return clean_text
    return clean_text[:max_len] + "..."


def add_paragraph_report(
    report, index, text, detected_type, applied_style, warning=None
):
    """添加段落识别和样式应用记录。"""
    report["paragraphs"].append(
        {
            "index": index,
            "text_preview": make_text_preview(text),
            "detected_type": detected_type,
            "applied_style": applied_style,
            "warning": warning,
        }
    )


def add_table_report(
    report, table_index, row_count, cell_count, applied_style, warning=None
):
    """添加表格处理记录。"""
    item = {
        "table_index": table_index,
        "row_count": row_count,
        "cell_count": cell_count,
        "applied_style": applied_style,
    }
    if warning:
        item["warning"] = warning
    report["tables"].append(item)


def add_warning(report, paragraph_index, text, message):
    """添加警告信息。"""
    report["warnings"].append(
        {
            "paragraph_index": paragraph_index,
            "text_preview": make_text_preview(text),
            "message": message,
        }
    )


def save_report(report, report_path):
    """保存 JSON 报告文件。"""
    path = Path(report_path)
    if path.exists() and path.is_dir():
        raise ReportError(f"报告路径不能是文件夹：{path}")

    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("w", encoding="utf-8") as file:
            json.dump(report, file, ensure_ascii=False, indent=2)
            file.write("\n")
    except OSError as exc:
        raise ReportError(f"保存报告失败：{path}，请检查目录写入权限。") from exc


def is_explicit_keywords(text: str) -> bool:
    """判断是否是关键词段落。"""
    return text.startswith("关键词：") or text.startswith("关键词:")


def is_reference_title(text: str) -> bool:
    """判断是否是参考文献标题。"""
    return text in {"参考文献", "参考文献：", "参考文献:"}


def is_title_candidate(text: str) -> bool:
    """标题保护规则：过长或明显句子结尾的段落，不当作标题。"""
    if len(text) > 40:
        return False
    if text.endswith(tuple(SENTENCE_ENDING_PUNCTUATION)):
        return False
    return True


def detect_number_heading_type(text: str) -> str | None:
    """识别 1、1.1、1.1.1 这类数字编号标题。"""
    match = re.match(r"^(\d+(?:\.\d+)*)(?:[\.、\s]+)\S+", text)
    if not match:
        return None

    level = match.group(1).count(".") + 1
    if level == 1:
        return "heading_1"
    if level == 2:
        return "heading_2"
    return "heading_3"


def detect_caption_type(text: str) -> str | None:
    """识别表题和图题，例如“表1 xxx”“图 1-1 xxx”。"""
    if TABLE_CAPTION_PATTERN.match(text):
        return "table_caption"
    if FIGURE_CAPTION_PATTERN.match(text):
        return "figure_caption"
    return None


def detect_paragraph_type(text, index, context):
    """用正则和上下文识别段落类型，不使用 AI 判断。"""
    if not text:
        return "empty"

    if is_reference_title(text):
        context["in_reference_section"] = True
        context["in_abstract_section"] = False
        return "reference_title"

    if context.get("in_reference_section"):
        return "reference_item"

    if text == "摘要":
        context["in_abstract_section"] = True
        return "abstract_title"

    if text in {"摘要：", "摘要:"}:
        context["in_abstract_section"] = True
        return "abstract_title"

    if text.startswith("摘要：") or text.startswith("摘要:"):
        context["in_abstract_section"] = False
        return "abstract_content"

    if is_explicit_keywords(text):
        context["in_abstract_section"] = False
        return "keywords"

    if context.get("in_abstract_section"):
        if is_title_candidate(text) and (
            re.match(rf"^[{CHINESE_NUMBER}]+[、.．]\s*\S+", text)
            or re.match(rf"^[（(][{CHINESE_NUMBER}]+[）)]\s*\S*", text)
            or detect_number_heading_type(text)
        ):
            context["in_abstract_section"] = False
        else:
            return "abstract_content"

    caption_type = detect_caption_type(text)
    if caption_type:
        return caption_type

    if not context.get("first_non_empty_seen"):
        if text not in PROTECTED_FIRST_PARAGRAPHS and is_title_candidate(text):
            return "paper_title"

    if not is_title_candidate(text):
        return "body"

    if re.match(rf"^[{CHINESE_NUMBER}]+[、.．]\s*\S+", text):
        return "heading_1"

    if re.match(rf"^[（(][{CHINESE_NUMBER}]+[）)]\s*\S*", text):
        return "heading_2"

    number_heading_type = detect_number_heading_type(text)
    if number_heading_type:
        return number_heading_type

    return "body"


def detect_paragraph_warning(text: str, paragraph_type: str) -> str | None:
    """识别可能存在误判风险的段落。"""
    if paragraph_type == "table_caption" and len(text) > 50:
        return "该段类似表题，但长度较长，请人工确认"

    if paragraph_type == "figure_caption" and len(text) > 50:
        return "该段类似图题，但长度较长，请人工确认"

    if paragraph_type != "body" or len(text) <= 40:
        return None

    if re.match(r"^\d+(?:\.\d+)*[\.、\s]", text):
        return "该段以数字编号开头但长度较长，已按正文处理"

    if re.match(rf"^[{CHINESE_NUMBER}]+[、.．]", text):
        return "该段类似中文一级标题，但长度较长，请人工确认"

    return None


def get_style_config(
    template, paragraph_type, report=None, paragraph_index=None, text=""
):
    """根据段落类型获取模板样式；缺失时回退到 body。"""
    styles = template["styles"]
    if paragraph_type in styles:
        return styles[paragraph_type], paragraph_type, None

    runtime = template.setdefault("_runtime", {})
    runtime["fallback_count"] = runtime.get("fallback_count", 0) + 1
    warned = runtime.setdefault("warned_missing_styles", set())
    message = f"未找到 {paragraph_type} 样式，已使用 body 样式代替"

    if paragraph_type not in warned:
        print(f"警告：{message}")
        warned.add(paragraph_type)

    if report is not None:
        add_warning(report, paragraph_index, text, message)

    return styles["body"], "body", message


def get_alignment(alignment_name: str | None):
    """把模板里的对齐字符串映射为 python-docx 枚举。"""
    alignments = {
        "left": WD_ALIGN_PARAGRAPH.LEFT,
        "center": WD_ALIGN_PARAGRAPH.CENTER,
        "right": WD_ALIGN_PARAGRAPH.RIGHT,
        "justify": WD_ALIGN_PARAGRAPH.JUSTIFY,
    }
    return alignments.get((alignment_name or "left").lower(), WD_ALIGN_PARAGRAPH.LEFT)


def apply_run_font(run, style_config) -> None:
    """设置 run 的字体、字号、加粗，并确保中文 eastAsia 字体生效。"""
    font_name = style_config.get("font", DEFAULT_STYLE["font"])
    font_size = style_config.get("size_pt", DEFAULT_STYLE["size_pt"])
    color = style_config.get("color", DEFAULT_STYLE["color"])
    bold = style_config.get("bold", DEFAULT_STYLE["bold"])
    italic = style_config.get("italic", DEFAULT_STYLE["italic"])

    run.font.name = font_name
    run.font.size = Pt(font_size)
    if color:
        run.font.color.rgb = RGBColor.from_string(str(color))
    run.bold = bold
    run.italic = italic

    r_pr = run._element.get_or_add_rPr()
    r_fonts = r_pr.rFonts
    if r_fonts is None:
        r_fonts = OxmlElement("w:rFonts")
        r_pr.append(r_fonts)

    r_fonts.set(qn("w:ascii"), font_name)
    r_fonts.set(qn("w:hAnsi"), font_name)
    r_fonts.set(qn("w:eastAsia"), font_name)
    r_fonts.set(qn("w:cs"), font_name)


def apply_paragraph_style(paragraph, style_config) -> None:
    """根据模板 style_config 设置段落格式。"""
    paragraph_format = paragraph.paragraph_format

    paragraph.alignment = get_alignment(style_config.get("alignment"))
    paragraph_format.line_spacing = style_config.get(
        "line_spacing", DEFAULT_STYLE["line_spacing"]
    )
    paragraph_format.first_line_indent = Pt(
        style_config.get("first_line_indent_pt", DEFAULT_STYLE["first_line_indent_pt"])
    )
    paragraph_format.space_before = Pt(
        style_config.get("space_before_pt", DEFAULT_STYLE["space_before_pt"])
    )
    paragraph_format.space_after = Pt(
        style_config.get("space_after_pt", DEFAULT_STYLE["space_after_pt"])
    )

    for run in paragraph.runs:
        apply_run_font(run, style_config)


def apply_normal_style(doc, template) -> None:
    """用 body 样式设置 Word Normal 样式。"""
    body_style, _, _ = get_style_config(template, "body")
    style = doc.styles["Normal"]
    style.font.name = body_style.get("font", DEFAULT_STYLE["font"])
    style.font.size = Pt(body_style.get("size_pt", DEFAULT_STYLE["size_pt"]))
    if body_style.get("color"):
        style.font.color.rgb = RGBColor.from_string(str(body_style["color"]))

    r_pr = style._element.get_or_add_rPr()
    r_fonts = r_pr.rFonts
    if r_fonts is None:
        r_fonts = OxmlElement("w:rFonts")
        r_pr.append(r_fonts)

    font_name = body_style.get("font", DEFAULT_STYLE["font"])
    r_fonts.set(qn("w:ascii"), font_name)
    r_fonts.set(qn("w:hAnsi"), font_name)
    r_fonts.set(qn("w:eastAsia"), font_name)
    r_fonts.set(qn("w:cs"), font_name)


def apply_page_settings(doc, template) -> None:
    """根据模板 page 配置设置页面边距。"""
    page = template["page"]
    top_margin = Cm(page.get("top_margin_cm", 2.5))
    bottom_margin = Cm(page.get("bottom_margin_cm", 2.5))
    left_margin = Cm(page.get("left_margin_cm", 2.5))
    right_margin = Cm(page.get("right_margin_cm", 2.5))

    for section in doc.sections:
        section.top_margin = top_margin
        section.bottom_margin = bottom_margin
        section.left_margin = left_margin
        section.right_margin = right_margin


def increment_stat(context: dict, paragraph_type: str) -> None:
    """记录每类段落处理数量。"""
    stats = context["stats"]
    stats[paragraph_type] = stats.get(paragraph_type, 0) + 1


def format_normal_paragraphs(doc, template, report) -> dict:
    """遍历普通段落，识别论文结构并按模板套用格式。"""
    context = {
        "first_non_empty_seen": False,
        "in_reference_section": False,
        "in_abstract_section": False,
        "stats": {},
        "non_empty_count": 0,
    }

    for index, paragraph in enumerate(doc.paragraphs):
        text = paragraph.text.strip()
        paragraph_type = detect_paragraph_type(text, index, context)
        warning_messages = []
        applied_style = None

        if paragraph_type != "empty":
            context["non_empty_count"] += 1

            paragraph_warning = detect_paragraph_warning(text, paragraph_type)
            if paragraph_warning:
                warning_messages.append(paragraph_warning)
                add_warning(report, index, text, paragraph_warning)

            style_config, applied_style, style_warning = get_style_config(
                template, paragraph_type, report, index, text
            )
            if style_warning:
                warning_messages.append(style_warning)

            apply_paragraph_style(paragraph, style_config)
            add_paragraph_report(
                report,
                index,
                text,
                paragraph_type,
                applied_style,
                "；".join(warning_messages) if warning_messages else None,
            )

        increment_stat(context, paragraph_type)

        if paragraph_type != "empty":
            context["first_non_empty_seen"] = True

    if context["non_empty_count"] == 0:
        add_warning(report, None, "", "未检测到有效正文段落")

    return context


def iter_tables(tables):
    """递归获取普通表格和嵌套表格。"""
    for table in tables:
        yield table
        for row in table.rows:
            for cell in row.cells:
                yield from iter_tables(cell.tables)


def format_tables(doc, template, report) -> int:
    """统一设置表格内文字格式，并记录表格报告。"""
    table_count = 0

    for table_index, table in enumerate(iter_tables(doc.tables)):
        table_count += 1
        row_count = len(table.rows)
        cell_count = sum(len(row.cells) for row in table.rows)
        style_config, applied_style, style_warning = get_style_config(
            template, "table_text", report, None, f"表格 {table_index}"
        )

        for row in table.rows:
            for cell in row.cells:
                for paragraph in cell.paragraphs:
                    apply_paragraph_style(paragraph, style_config)

        add_table_report(
            report,
            table_index,
            row_count,
            cell_count,
            applied_style,
            warning=style_warning,
        )

    return table_count


def build_report_stats(stats, report, template) -> dict:
    """生成报告和命令行共用的统计信息。"""
    report_stats = {key: stats.get(key, 0) for key in REPORT_STAT_KEYS}
    report_stats["table"] = stats.get("table", 0)
    report_stats["style_fallback_count"] = template.get("_runtime", {}).get(
        "fallback_count", 0
    )
    report_stats["warning_count"] = len(report["warnings"])
    return report_stats


def open_document(input_path: Path):
    """打开 Word 文档，并把常见打开失败转换成中文提示。"""
    try:
        return Document(str(input_path))
    except Exception as exc:
        raise UserFacingError(
            "无法打开 Word 文件。请确认它是有效的 .docx 文件，并且没有被 Word/WPS 占用。"
        ) from exc


def safe_save_document(doc, output_path: Path, overwrite: bool = False) -> None:
    """先保存到临时文件，再替换为最终输出文件，避免半成品。"""
    temp_path = None
    try:
        if output_path.exists() and not overwrite:
            raise UserFacingError(f"输出文件已存在：{output_path}\n如需覆盖，请添加 --overwrite 参数。")

        with tempfile.NamedTemporaryFile(
            prefix=f".{output_path.stem}.",
            suffix=".tmp.docx",
            dir=str(output_path.parent),
            delete=False,
        ) as temp_file:
            temp_path = Path(temp_file.name)

        doc.save(str(temp_path))

        if output_path.exists() and not overwrite:
            raise UserFacingError(f"输出文件已存在：{output_path}\n如需覆盖，请添加 --overwrite 参数。")

        os.replace(temp_path, output_path)
        temp_path = None
    except UserFacingError:
        raise
    except Exception as exc:
        raise UserFacingError(
            "保存输出文件失败。请确认目标文件没有被 Word/WPS 打开，并且当前目录有写入权限。"
        ) from exc
    finally:
        if temp_path and temp_path.exists():
            try:
                temp_path.unlink()
            except OSError:
                pass


def format_document(input_path: Path, output_path: Path, template, report, overwrite=False) -> dict:
    """读取 Word 文件，修改格式，安全保存新文件，并返回统计结果。"""
    doc = open_document(input_path)

    apply_normal_style(doc, template)
    apply_page_settings(doc, template)

    context = format_normal_paragraphs(doc, template, report)
    context["stats"]["table"] = format_tables(doc, template, report)

    report_stats = build_report_stats(context["stats"], report, template)
    report["stats"] = report_stats

    safe_save_document(doc, output_path, overwrite=overwrite)
    return report_stats


def print_report(
    output_path: str,
    template: dict,
    stats: dict,
    report_path: str | None = None,
    overwritten: bool = False,
) -> None:
    """输出处理完成信息、模板信息和统计报告。"""
    abstract_count = (
        stats.get("abstract_title", 0)
        + stats.get("abstract_content", 0)
    )
    keywords_count = stats.get("keywords", 0)
    reference_count = stats.get("reference_title", 0) + stats.get("reference_item", 0)
    override_metadata = template.get("_override", {"enabled": False})

    print(f"格式修改完成：{output_path}")
    if override_metadata.get("enabled"):
        base_template = template.get("_base_template", {})
        print(f"使用基础模板：{base_template.get('name', '未命名模板')}")
        print(f"使用自定义覆盖：{override_metadata.get('path', '')}")
        print(f"覆盖字段数量：{len(override_metadata.get('overridden_fields', []))}")
        print(f"使用最终规则：{template.get('name', '未命名模板')}")
    else:
        print(f"使用模板：{template.get('name', '未命名模板')}")
        print(f"模板说明：{template.get('description', '无')}")
    if report_path:
        print(f"报告文件：{report_path}")
    if overwritten:
        print("提示：已覆盖已有输出文件。")
    print()
    print("处理统计：")
    print(f"- 论文标题：{stats.get('paper_title', 0)}")
    print(f"- 一级标题：{stats.get('heading_1', 0)}")
    print(f"- 二级标题：{stats.get('heading_2', 0)}")
    print(f"- 三级标题：{stats.get('heading_3', 0)}")
    print(f"- 表题：{stats.get('table_caption', 0)}")
    print(f"- 图题：{stats.get('figure_caption', 0)}")
    print(f"- 正文段落：{stats.get('body', 0)}")
    print(f"- 摘要相关段落：{abstract_count}")
    print(f"- 关键词段落：{keywords_count}")
    print(f"- 参考文献：{reference_count}")
    print(f"- 表格：{stats.get('table', 0)}")
    print(f"- 使用默认 body 回退次数：{stats.get('style_fallback_count', 0)}")
    print(f"- 警告数量：{stats.get('warning_count', 0)}")


def validate_template_command(template_arg: str) -> int:
    """只校验模板 JSON，不进入 Word 处理流程。"""
    template_path = resolve_template_path(template_arg)

    try:
        raw_template = read_template_json(template_path)
        normalized_template = normalize_format_rules(raw_template)
        normalization_warnings = normalized_template.get("_template_warnings", [])
        errors, validation_warnings = validate_format_rules(normalized_template)
        warnings = normalization_warnings + validation_warnings
    except TemplateError as exc:
        print(f"模板校验失败：{template_arg}")
        print("错误：")
        print(f"- {exc}")
        return 1

    if errors:
        print(f"模板校验失败：{template_arg}")
        print("错误：")
        for error in errors:
            print(f"- {error}")
        if warnings:
            print()
            print("警告：")
            for warning in warnings:
                print(f"- {warning}")
        return 1

    supported_style_count = sum(
        1
        for style_name in normalized_template.get("styles", {})
        if style_name in SUPPORTED_STYLE_TYPES
    )
    print(f"模板校验通过：{template_arg}")
    print(f"模板名称：{normalized_template.get('description') or normalized_template.get('name')}")
    print(f"模板版本：{normalized_template.get('version', '未声明')}")
    print(f"支持样式数量：{supported_style_count}")
    if warnings:
        print()
        print("警告：")
        for warning in warnings:
            print(f"- {warning}")
    return 0


def merge_rules_command(args) -> int:
    """只合并格式规则，不处理 Word。"""
    rules = get_final_format_rules(
        template_arg=args.template,
        override_path=args.override,
        print_warnings=True,
    )

    if args.export_final_rules:
        export_final_rules(rules, args.export_final_rules)
    if args.export_debug_rules:
        export_debug_rules(rules, args.export_debug_rules)

    override_metadata = rules.get("_override", {"enabled": False})
    print("格式规则合并完成。")
    print(f"基础模板：{rules.get('_base_template', {}).get('name', rules.get('name', 'default'))}")
    print(f"自定义覆盖：{override_metadata.get('path', '未使用') if override_metadata.get('enabled') else '未使用'}")
    print(f"最终规则：{args.export_final_rules or '未导出'}")
    print(f"调试规则：{args.export_debug_rules or '未导出'}")
    print(f"覆盖字段数量：{len(override_metadata.get('overridden_fields', []))}")
    print(f"警告数量：{len(override_metadata.get('warnings', []))}")
    return 0


def main(argv=None) -> int:
    args = parse_args(argv)

    if args.validate_template:
        return validate_template_command(args.validate_template)

    if args.merge_rules:
        return merge_rules_command(args)

    if not args.input_docx or not args.output_docx:
        raise UserFacingError(
            "请提供 input.docx 和 output.docx，或使用 --validate-template / --merge-rules。"
        )

    input_path = Path(args.input_docx)
    output_path = Path(args.output_docx)
    output_existed = output_path.exists()

    ensure_dependency_installed()
    validate_paths(input_path, output_path, overwrite=args.overwrite)

    template = get_final_format_rules(
        template_arg=args.template,
        override_path=args.override,
        print_warnings=True,
    )
    if args.export_final_rules:
        export_final_rules(template, args.export_final_rules)
    if args.export_debug_rules:
        export_debug_rules(template, args.export_debug_rules)

    report = init_report(args.input_docx, args.output_docx, template)
    stats = format_document(
        input_path,
        output_path,
        template,
        report,
        overwrite=args.overwrite,
    )
    if args.report:
        save_report(report, args.report)

    print_report(
        args.output_docx,
        template,
        stats,
        args.report,
        overwritten=args.overwrite and output_existed,
    )
    return 0


if __name__ == "__main__":
    debug_enabled = "--debug" in sys.argv
    try:
        sys.exit(main())
    except UserFacingError as exc:
        print_error(str(exc))
        if debug_enabled:
            traceback.print_exc()
        sys.exit(1)
    except Exception:
        print_error("程序遇到未知异常。可使用 --debug 查看详细信息。")
        if debug_enabled:
            traceback.print_exc()
        sys.exit(1)
