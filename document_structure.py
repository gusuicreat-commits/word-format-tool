"""Read-only structural evidence for the formatter, not a Word layout engine."""
from __future__ import annotations

import re

from docx.oxml.ns import qn
from docx.opc.constants import RELATIONSHIP_TYPE as RT
from docx.text.paragraph import Paragraph


def style_chain(paragraph):
    """Follow basedOn without looping on malformed style graphs."""
    if not any(rel.reltype == RT.STYLES and not rel.is_external for rel in paragraph.part.rels.values()):
        return
    seen = set()
    style = paragraph.style
    while style is not None and style.style_id not in seen:
        seen.add(style.style_id)
        yield style
        style = style.base_style


def property_sources(paragraph):
    if paragraph._p.pPr is not None:
        yield "direct", paragraph._p.pPr
    for style in style_chain(paragraph):
        properties = style.element.find(qn("w:pPr"))
        if properties is not None:
            yield "style:" + style.style_id, properties
    styles = next((rel.target_part.element for rel in paragraph.part.rels.values()
                   if rel.reltype == RT.STYLES and not rel.is_external), None)
    if styles is None:
        return
    defaults = styles.find(qn("w:docDefaults"))
    if defaults is not None:
        pdefault = defaults.find(qn("w:pPrDefault"))
        if pdefault is not None:
            properties = pdefault.find(qn("w:pPr"))
            if properties is not None:
                yield "docDefaults", properties


def effective_outline(paragraph):
    for source, properties in property_sources(paragraph):
        level = properties.find(qn("w:outlineLvl"))
        if level is not None:
            value = level.get(qn("w:val"))
            # Invalid explicit values are not evidence for a heading either.
            return {"value": int(value) if value and value.isdigit() else None,
                    "source": source}
    return {"value": None, "source": None}


def effective_numbering(paragraph):
    values, sources = {}, {}
    for source, properties in property_sources(paragraph):
        numpr = properties.find(qn("w:numPr"))
        if numpr is None:
            continue
        for tag, field in (("w:numId", "num_id"), ("w:ilvl", "level")):
            node = numpr.find(qn(tag))
            if field not in values and node is not None:
                values[field] = node.get(qn("w:val"))
                sources[field] = source
    if "num_id" not in values:
        return None
    level = values.get("level", "0")
    if sources["num_id"].startswith("style:") and values["num_id"] != "0":
        level = None
        sources["level"] = "unresolved"
        root = next((rel.target_part.element for rel in paragraph.part.rels.values()
                     if rel.reltype == RT.NUMBERING and not rel.is_external), None)
        num = next((n for n in root.findall(qn("w:num"))
                    if n.get(qn("w:numId")) == values["num_id"]), None) if root is not None else None
        abstract_id = num.find(qn("w:abstractNumId")) if num is not None else None
        abstract = next((n for n in root.findall(qn("w:abstractNum"))
                         if n.get(qn("w:abstractNumId")) == abstract_id.get(qn("w:val"))), None) if abstract_id is not None else None
        if abstract is None or abstract.find(qn("w:numStyleLink")) is not None:
            level = None
        else:
            levels = {n.get(qn("w:ilvl")): n for n in abstract.findall(qn("w:lvl"))}
            for override in num.findall(qn("w:lvlOverride")):
                replacement = override.find(qn("w:lvl"))
                if replacement is not None:
                    levels[override.get(qn("w:ilvl"))] = replacement
            linked = {n.find(qn("w:pStyle")).get(qn("w:val")): index
                      for index, n in levels.items() if n.find(qn("w:pStyle")) is not None}
            if linked:
                level = next((linked[s.style_id] for s in style_chain(paragraph) if s.style_id in linked), None)
                sources["level"] = "numbering:pStyle" if level is not None else "unresolved"
    return {"num_id": values["num_id"], "level": level,
            "enabled": values["num_id"] not in (None, "0"), "sources": sources}


def heading_evidence(paragraph):
    outline = effective_outline(paragraph)
    if outline["source"] is not None:
        value = outline["value"]
        return {"type": f"heading_{value + 1}" if value in (0, 1, 2) else None,
                "reason": "outline_level", **outline}
    for style in style_chain(paragraph):
        for name in (style.name or "", style.style_id or ""):
            normalized = re.sub(r"[\s_-]+", "", name).casefold()
            match = re.fullmatch(r"(?:heading|标题)([123])", normalized)
            if match:
                return {"type": "heading_" + match.group(1),
                        "reason": "style_chain", "source": "style:" + style.style_id}
    return {"type": None, "reason": "no_structural_heading", "source": None}


def has_unresolved_sections(doc):
    supported = {section._sectPr for section in doc.sections}
    return any(node not in supported for node in doc.element.body.iter(qn("w:sectPr")))


def section_membership(doc):
    """A paragraph sectPr terminates its section; it does not start the next."""
    membership = {}
    if has_unresolved_sections(doc):
        return membership
    section_index = 0
    for block in doc.element.body:
        if block.tag == qn("w:sectPr"):
            continue
        for node in block.iter():
            membership[node] = section_index
        if block.tag == qn("w:p"):
            properties = block.find(qn("w:pPr"))
            if properties is not None and properties.find(qn("w:sectPr")) is not None:
                section_index += 1
    return membership


def section_record(section, index):
    columns = section._sectPr.find(qn("w:cols"))
    return {
        "index": index,
        "page_width_emu": section.page_width,
        "page_height_emu": section.page_height,
        "left_margin_emu": section.left_margin,
        "right_margin_emu": section.right_margin,
        "top_margin_emu": section.top_margin,
        "bottom_margin_emu": section.bottom_margin,
        "gutter_emu": section.gutter,
        "start_type": str(section.start_type),
        "columns": dict(columns.attrib) if columns is not None else {},
    }


def table_width_budget(doc, table, membership):
    """Conservative container bound, never a prediction of rendered width."""
    index = membership.get(table._tbl)
    if index is None or index >= len(doc.sections):
        return None
    section = doc.sections[index]
    if any(v is None for v in (section.page_width, section.left_margin, section.right_margin)):
        return None
    width = section.page_width - section.left_margin - section.right_margin - (section.gutter or 0)
    cols = section._sectPr.find(qn("w:cols"))
    if cols is not None:
        try:
            count = int(cols.get(qn("w:num"), "1"))
            explicit = cols.findall(qn("w:col"))
            if explicit:
                width = min(width, min(int(c.get(qn("w:w"))) * 635 for c in explicit))
            elif count > 1:
                gap = int(cols.get(qn("w:space"), "720")) * 635
                width = (width - gap * (count - 1)) // count
        except (TypeError, ValueError):
            return None
    # Nested-cell widths and table indents require a fuller width resolver.
    # Do not borrow the page width when their actual container is unknown.
    if any(parent.tag == qn("w:tc") for parent in table._tbl.iterancestors()):
        return None
    indent = table._tbl.tblPr.find(qn("w:tblInd"))
    if indent is not None:
        if indent.get(qn("w:type")) != "dxa":
            return None
        try:
            width -= max(0, int(indent.get(qn("w:w")))) * 635
        except (TypeError, ValueError):
            return None
    return max(0, width)


def declared_table_width(table, budget):
    """Largest declared width, not a final layout measurement."""
    def read_width(node, relative):
        if node is None:
            return 0
        kind = node.get(qn("w:type"))
        if kind in ("auto", "nil"):
            return 0
        value = float(node.get(qn("w:w")))
        if value < 0:
            raise ValueError("Negative table width")
        if kind == "dxa":
            return value * 635
        if kind == "pct":
            return relative * value / 5000
        raise ValueError("Unknown table width units")

    if budget is None:
        return None
    try:
        grid_columns = [column.w or 0 for column in table._tbl.tblGrid.gridCol_lst]
        grid = sum(grid_columns)
        column_bounds = list(grid_columns)
        preferred = read_width(table._tbl.tblPr.find(qn("w:tblW")), budget)
        widths = [grid, preferred]
        for row in table._tbl.tr_lst:
            before = row.trPr.find(qn("w:gridBefore")) if row.trPr is not None else None
            cursor = int(before.get(qn("w:val"))) if before is not None else 0
            row_width = 0
            for cell in row.tc_lst:
                cell_width = read_width(cell.tcPr.find(qn("w:tcW")) if cell.tcPr is not None else None,
                                        preferred or budget)
                span_node = cell.tcPr.find(qn("w:gridSpan")) if cell.tcPr is not None else None
                span = int(span_node.get(qn("w:val"))) if span_node is not None else 1
                if cursor < 0 or span < 1 or cursor + span > len(grid_columns):
                    return None
                if span == 1:
                    column_bounds[cursor] = max(column_bounds[cursor], cell_width)
                elif cell_width > sum(grid_columns[cursor:cursor + span]):
                    return None
                cursor += span
                row_width += cell_width
            if row.trPr is not None:
                row_width += sum(read_width(row.trPr.find(qn(tag)), preferred or budget)
                                 for tag in ("w:wBefore", "w:wAfter"))
            widths.append(row_width)
        return max(*widths, sum(column_bounds)) or None
    except (TypeError, ValueError):
        return None


def analyze_document(doc):
    """Return detached JSON data without creating parts or changing XML."""
    membership = section_membership(doc)
    tree = doc.element.getroottree()
    top_indices = {p._p: index for index, p in enumerate(doc.paragraphs)}
    paragraphs = []
    for node in doc.element.body.iter(qn("w:p")):
        paragraph = Paragraph(node, doc._body)
        ancestors = list(node.iterancestors())
        paragraphs.append({
            "node_id": str(doc.part.partname) + "#" + tree.getpath(node),
            "paragraph_index": top_indices.get(node),
            "section_index": membership.get(node),
            "container": ("textbox" if any(p.tag == qn("w:txbxContent") for p in ancestors)
                          else "table_cell" if any(p.tag == qn("w:tc") for p in ancestors) else "body"),
            "style_chain": [s.style_id for s in style_chain(paragraph)],
            "heading": heading_evidence(paragraph),
            "numbering": effective_numbering(paragraph),
            "inline_images": len(node.xpath('.//wp:inline')),
            "floating_images": len(node.xpath('.//wp:anchor')),
            "legacy_shapes": len(node.xpath('.//w:pict')),
            "has_fields": bool(node.xpath('.//w:fldChar | .//w:fldSimple')),
            "inside_revision": any(p.tag in (qn("w:ins"), qn("w:del")) for p in ancestors),
        })
    return {
        "schema_version": 1,
        "phase": "before_changes",
        "scope": "main_document_structure",
        "unresolved_sections": has_unresolved_sections(doc),
        "limitations": ["not_a_layout_validation", "not_a_full_character_format_resolver",
                        "other_stories_inventory_only", "nested_table_width_unresolved"],
        "parts": sorted(str(part.partname) for part in doc.part.package.parts),
        "sections": [section_record(section, i) for i, section in enumerate(doc.sections)],
        "paragraphs": paragraphs,
        "tables": [{"node_id": str(doc.part.partname) + "#" + tree.getpath(node),
                    "section_index": membership.get(node)}
                   for node in doc.element.body.iter(qn("w:tbl"))],
    }
