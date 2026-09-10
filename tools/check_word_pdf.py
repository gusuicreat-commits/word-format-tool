"""Screen a same-renderer PDF pair; never claim automatic visual approval."""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path

import pdfplumber


def inspect(path, directory):
    pages = []
    text = Counter()
    with pdfplumber.open(path) as document:
        for number, page in enumerate(document.pages, 1):
            chars = [c for c in page.chars if c.get("text", "").strip()]
            body = [c for c in chars if page.height * .1 < c["top"] < page.height * .9]
            outside = [c for c in chars if c["x0"] < -1 or c["x1"] > page.width + 1 or c["top"] < -1 or c["bottom"] > page.height + 1]
            overlaps = sum(any(min(c["x1"], im["x1"]) > max(c["x0"], im["x0"]) and
                               min(c["bottom"], im["bottom"]) > max(c["top"], im["top"])
                               for im in page.images) for c in chars)
            pages.append({"page": number, "characters_outside_page": len(outside),
                          "images_outside_page": sum(im["x0"] < -1 or im["x1"] > page.width + 1 or im["top"] < -1 or im["bottom"] > page.height + 1 for im in page.images),
                          "possible_text_image_overlap": overlaps,
                          "possible_blank_page": not body and not page.images,
                          "preview": f"{path.stem}-page-{number}.png"})
            text.update("".join(c["text"] for c in chars))
            page.to_image(resolution=108).save(directory / f"{path.stem}-page-{number}.png")
    if not pages:
        raise ValueError("PDF contains no pages")
    return {"sha256": hashlib.sha256(path.read_bytes()).hexdigest(), "pages": pages}, text


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--directory", type=Path, required=True)
    args = parser.parse_args()
    args.directory.mkdir(parents=True, exist_ok=True)
    source, before = inspect(args.source, args.directory)
    output, after = inspect(args.output, args.directory)
    metadata = []
    for path, inspected in ((args.source, source), (args.output, output)):
        info = Path(str(path) + ".json")
        if info.exists():
            value = json.loads(info.read_text(encoding="utf-8-sig"))
            if value.get("pdfSha256", "").casefold() != inspected["sha256"]:
                raise ValueError("PDF does not match export metadata")
            metadata.append(value)
    same_renderer = len(metadata) == 2 and all(metadata[0].get(k) == metadata[1].get(k) for k in ("renderer", "version", "build"))
    report = {"status": "manual_review_required", "same_renderer_verified": same_renderer,
              "source": source, "output": output,
              "missing_character_candidates": dict(before - after),
              "limitations": ["Overlap includes intentional backgrounds.", "Page numbers and fields can change text counts.",
                              "Page-boundary checks cannot detect all cell clipping.",
                              "Page correspondence and source-existing defects require human review."]}
    (args.directory / "layout-review.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"status": report["status"], "source_pages": len(source["pages"]), "output_pages": len(output["pages"])}))


if __name__ == "__main__":
    main()
