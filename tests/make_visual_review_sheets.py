"""Compact page overviews for layout triage; not a substitute for full-size review."""
import argparse
import json
from pathlib import Path
from PIL import Image, ImageDraw


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("directory", type=Path)
    args = parser.parse_args()
    manifest = []
    for directory in sorted(p for p in args.directory.iterdir() if p.is_dir()):
        pages = sorted(directory.glob("page-*.png"), key=lambda p: int(p.stem.split("-")[-1]))
        for offset in range(0, len(pages), 12):
            sheet = Image.new("RGB", (1400, 1560), "#dddddd")
            draw = ImageDraw.Draw(sheet)
            for position, page in enumerate(pages[offset:offset + 12]):
                with Image.open(page) as original:
                    thumbnail = original.copy()
                    thumbnail.thumbnail((340, 490))
                x, y = (position % 4) * 350, (position // 4) * 520
                draw.text((x + 5, y + 3), page.stem, fill="black")
                sheet.paste(thumbnail, (x + 5, y + 22))
            path = directory / f"review12-{offset // 12 + 1}.png"
            sheet.save(path)
            manifest.append({"path": str(path.resolve()), "first_page": offset + 1,
                             "last_page": min(offset + 12, len(pages))})
    (args.directory / "review-sheets.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(json.dumps({"sheets": len(manifest), "pages": sum(x["last_page"] - x["first_page"] + 1 for x in manifest)}))


if __name__ == "__main__":
    main()
