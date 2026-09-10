"""Create QA overview sheets and record page-boundary checks, not visual approval."""

import argparse
import json
from pathlib import Path

import pdfplumber
from PIL import Image, ImageDraw


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("directory", type=Path)
    args = parser.parse_args()
    results = []
    for pdf in sorted(args.directory.glob("*/*.pdf")):
        pages = []
        with pdfplumber.open(pdf) as document:
            for index, page in enumerate(document.pages, 1):
                outside = [char for char in page.chars if char.get("text", "").strip() and
                           (char["x0"] < -1 or char["x1"] > page.width + 1 or
                            char["top"] < -1 or char["bottom"] > page.height + 1)]
                pages.append({"page": index, "characters": len(page.chars),
                              "images": len(page.images), "characters_outside_page": len(outside),
                              "body_characters": sum(bool(c.get("text", "").strip()) and page.height * .1 < c["top"] < page.height * .9 for c in page.chars),
                              "images_outside_page": sum(im["x0"] < -1 or im["x1"] > page.width + 1 or im["top"] < -1 or im["bottom"] > page.height + 1 for im in page.images)})
        images = sorted(pdf.parent.glob("page-*.png"), key=lambda p: int(p.stem.split("-")[-1]))
        for offset in range(0, len(images), 6):
            sheet = Image.new("RGB", (1500, 1480), "#dddddd")
            draw = ImageDraw.Draw(sheet)
            for position, path in enumerate(images[offset:offset + 6]):
                with Image.open(path) as original:
                    thumbnail = original.copy()
                    thumbnail.thumbnail((490, 700))
                x, y = (position % 3) * 500, (position // 3) * 740
                draw.text((x + 8, y + 5), path.stem, fill="black")
                sheet.paste(thumbnail, (x + 5, y + 25))
            sheet.save(pdf.parent / f"overview-{offset // 6 + 1}.png")
        results.append({"pdf": str(pdf), "pages": pages,
                        "note": "Boundary checks cannot establish absence of overlap or correct reading order."})
    destination = args.directory / "page-checks.json"
    destination.write_text(json.dumps(results, indent=2), encoding="utf-8")
    print(json.dumps({"documents": len(results), "pages": sum(len(item["pages"]) for item in results),
                      "characters_outside_pages": sum(page["characters_outside_page"] for item in results for page in item["pages"])}))


if __name__ == "__main__":
    main()
